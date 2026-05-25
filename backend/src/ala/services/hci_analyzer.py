"""Bluetooth HCI (BTSnoop) log analyzer service."""

import gzip
import io
import os
import struct
import zipfile
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime

# ── BTSnoop magic bytes ────────────────────────────────────────────────
BTSNOOP_MAGIC = b"btsnoop\x00"

# ── HCI packet type constants (from packet_flags bits 2-3) ─────────────
HCI_TYPE_COMMAND = 0
HCI_TYPE_ACL = 1
HCI_TYPE_SCO = 2
HCI_TYPE_EVENT = 3
HCI_TYPE_ISO = 4  # Bluetooth 5.2+, indicated by bit 4 in flags

HCI_TYPE_NAMES: dict[int, str] = {
    HCI_TYPE_COMMAND: "COMMAND",
    HCI_TYPE_ACL: "ACL_DATA",
    HCI_TYPE_SCO: "SCO_DATA",
    HCI_TYPE_EVENT: "EVENT",
    HCI_TYPE_ISO: "ISO_DATA",
}

# Direction strings
DIRECTION_HOST_TO_CONTROLLER = "HOST_TO_CONTROLLER"
DIRECTION_CONTROLLER_TO_HOST = "CONTROLLER_TO_HOST"

# ── HCI OGF Group Names ────────────────────────────────────────────────
OGF_NAMES: dict[int, str] = {
    0x01: "Link Control",
    0x02: "Link Policy",
    0x03: "HCI Control & Baseband",
    0x04: "Informational Parameters",
    0x05: "Status Parameters",
    0x06: "Testing",
    0x07: "LE Controller",
    0x08: "Link Control",
    0x3F: "Vendor Specific",
}

# ── HCI Command Opcode → Name Lookup ───────────────────────────────────
# opcode = (OGF << 10) | OCF

HCI_OPCODES: dict[int, str] = {
    # ── Link Control (OGF 0x01) ──
    0x0001: "INQUIRY",
    0x0002: "INQUIRY_CANCEL",
    0x0003: "PERIODIC_INQUIRY_MODE",
    0x0004: "EXIT_PERIODIC_INQUIRY_MODE",
    0x0005: "CREATE_CONNECTION",
    0x0006: "DISCONNECT",
    0x0007: "CREATE_CONNECTION_CANCEL",
    0x0008: "ACCEPT_CONNECTION_REQUEST",
    0x0009: "REJECT_CONNECTION_REQUEST",
    0x000A: "LINK_KEY_REQUEST_REPLY",
    0x000B: "LINK_KEY_REQUEST_NEGATIVE_REPLY",
    0x000C: "PIN_CODE_REQUEST_REPLY",
    0x000D: "PIN_CODE_REQUEST_NEGATIVE_REPLY",
    0x000E: "CHANGE_CONNECTION_PACKET_TYPE",
    0x000F: "AUTHENTICATION_REQUESTED",
    0x0011: "SET_CONNECTION_ENCRYPTION",
    0x0013: "CHANGE_CONNECTION_LINK_KEY",
    0x0015: "REMOTE_NAME_REQUEST",
    0x0017: "READ_REMOTE_SUPPORTED_FEATURES",
    0x0019: "READ_REMOTE_VERSION_INFORMATION",
    0x001B: "READ_CLOCK_OFFSET",
    0x001D: "READ_REMOTE_EXTENDED_FEATURES",
    # ── Link Policy (OGF 0x02) ──
    0x0801: "HOLD_MODE",
    0x0803: "SNIFF_MODE",
    0x0804: "EXIT_SNIFF_MODE",
    0x0805: "PARK_STATE",
    0x0806: "EXIT_PARK_STATE",
    0x0807: "QOS_SETUP",
    0x0809: "ROLE_DISCOVERY",
    0x080B: "SWITCH_ROLE",
    0x080D: "READ_LINK_POLICY_SETTINGS",
    0x080F: "WRITE_LINK_POLICY_SETTINGS",
    0x0811: "READ_DEFAULT_LINK_POLICY_SETTINGS",
    0x0813: "WRITE_DEFAULT_LINK_POLICY_SETTINGS",
    0x0815: "FLOW_SPECIFICATION",
    0x0817: "SNIFF_SUBRATING",
    # ── HCI Control & Baseband (OGF 0x03) ──
    0x0C01: "SET_EVENT_MASK",
    0x0C03: "RESET",
    0x0C05: "SET_EVENT_FILTER",
    0x0C07: "FLUSH",
    0x0C08: "READ_PIN_TYPE",
    0x0C09: "WRITE_PIN_TYPE",
    0x0C0B: "CREATE_NEW_UNIT_KEY",
    0x0C0D: "READ_STORED_LINK_KEY",
    0x0C0F: "WRITE_STORED_LINK_KEY",
    0x0C11: "DELETE_STORED_LINK_KEY",
    0x0C13: "WRITE_LOCAL_NAME",
    0x0C15: "READ_LOCAL_NAME",
    0x0C17: "READ_CONNECTION_ACCEPT_TIMEOUT",
    0x0C18: "WRITE_CONNECTION_ACCEPT_TIMEOUT",
    0x0C19: "READ_PAGE_TIMEOUT",
    0x0C1B: "WRITE_PAGE_TIMEOUT",
    0x0C1D: "READ_SCAN_ENABLE",
    0x0C1F: "WRITE_SCAN_ENABLE",
    0x0C21: "READ_PAGE_SCAN_ACTIVITY",
    0x0C23: "WRITE_PAGE_SCAN_ACTIVITY",
    0x0C25: "READ_INQUIRY_SCAN_ACTIVITY",
    0x0C27: "WRITE_INQUIRY_SCAN_ACTIVITY",
    0x0C29: "READ_AUTHENTICATION_ENABLE",
    0x0C2B: "WRITE_AUTHENTICATION_ENABLE",
    0x0C2F: "READ_CLASS_OF_DEVICE",
    0x0C31: "WRITE_CLASS_OF_DEVICE",
    0x0C35: "READ_VOICE_SETTING",
    0x0C37: "WRITE_VOICE_SETTING",
    0x0C41: "READ_NUM_BROADCAST_RETRANSMISSIONS",
    0x0C43: "WRITE_NUM_BROADCAST_RETRANSMISSIONS",
    0x0C45: "READ_HOLD_MODE_ACTIVITY",
    0x0C47: "WRITE_HOLD_MODE_ACTIVITY",
    0x0C4D: "READ_SYNCHRONOUS_FLOW_CONTROL_ENABLE",
    0x0C4F: "WRITE_SYNCHRONOUS_FLOW_CONTROL_ENABLE",
    0x0C53: "SET_CONTROLLER_TO_HOST_FLOW_CONTROL",
    0x0C55: "HOST_BUFFER_SIZE",
    0x0C57: "HOST_NUMBER_OF_COMPLETED_PACKETS",
    0x0C59: "READ_LINK_SUPERVISION_TIMEOUT",
    0x0C5B: "WRITE_LINK_SUPERVISION_TIMEOUT",
    0x0C5D: "READ_NUMBER_OF_SUPPORTED_IAC",
    0x0C5F: "READ_CURRENT_IAC_LAP",
    0x0C61: "WRITE_CURRENT_IAC_LAP",
    0x0C68: "SET_AFH_HOST_CHANNEL_CLASSIFICATION",
    0x0C77: "READ_INQUIRY_SCAN_TYPE",
    0x0C79: "WRITE_INQUIRY_SCAN_TYPE",
    0x0C7B: "READ_INQUIRY_MODE",
    0x0C7D: "WRITE_INQUIRY_MODE",
    0x0C7F: "READ_PAGE_SCAN_TYPE",
    0x0C81: "WRITE_PAGE_SCAN_TYPE",
    0x0C83: "READ_AFH_CHANNEL_ASSESSMENT_MODE",
    0x0C85: "WRITE_AFH_CHANNEL_ASSESSMENT_MODE",
    0x0C8D: "READ_EXTENDED_INQUIRY_RESPONSE",
    0x0C8F: "WRITE_EXTENDED_INQUIRY_RESPONSE",
    0x0C9B: "READ_SIMPLE_PAIRING_MODE",
    0x0C9D: "WRITE_SIMPLE_PAIRING_MODE",
    0x0C9F: "READ_LOCAL_OOB_DATA",
    0x0CA1: "READ_INQUIRY_RESPONSE_TRANSMIT_POWER_LEVEL",
    0x0CA3: "WRITE_INQUIRY_TRANSMIT_POWER_LEVEL",
    0x0CA5: "READ_DEFAULT_ERRONEOUS_DATA_REPORTING",
    0x0CA7: "WRITE_DEFAULT_ERRONEOUS_DATA_REPORTING",
    0x0CA9: "ENHANCED_FLUSH",
    0x0CAD: "SEND_KEYPRESS_NOTIFICATION",
    0x0CB1: "READ_ENHANCED_TRANSMIT_POWER_LEVEL",
    0x0CB3: "READ_LE_HOST_SUPPORT",
    0x0CB5: "WRITE_LE_HOST_SUPPORT",
    0x0CB7: "SET_EVENT_MASK_PAGE_2",
    0x0CB9: "READ_AUTHENTICATED_PAYLOAD_TIMEOUT",
    0x0CBB: "WRITE_AUTHENTICATED_PAYLOAD_TIMEOUT",
    # ── Informational Parameters (OGF 0x04) ──
    0x1001: "READ_LOCAL_VERSION_INFORMATION",
    0x1005: "READ_LOCAL_SUPPORTED_COMMANDS",
    0x1009: "READ_LOCAL_SUPPORTED_FEATURES",
    0x100D: "READ_LOCAL_EXTENDED_FEATURES",
    0x100F: "READ_BUFFER_SIZE",
    0x1011: "READ_BD_ADDR",
    0x1015: "READ_LOCAL_SUPPORTED_CODECS_V1",
    0x1017: "READ_LOCAL_SUPPORTED_CODECS_V2",
    0x1019: "READ_LOCAL_SIMPLE_PAIRING_OPTIONS",
    # ── Status Parameters (OGF 0x05) ──
    0x1401: "READ_FAILED_CONTACT_COUNTER",
    0x1405: "READ_RSSI",
    0x1409: "READ_AFH_CHANNEL_MAP",
    0x140B: "READ_CLOCK",
    0x140F: "READ_ENCRYPTION_KEY_SIZE",
    0x1413: "READ_LOCAL_AMP_INFO",
    # ── Testing (OGF 0x06) ──
    0x1801: "READ_LOOPBACK_MODE",
    0x1803: "WRITE_LOOPBACK_MODE",
    0x1807: "WRITE_SIMPLE_PAIRING_DEBUG_MODE",
    # ── LE Controller (OGF 0x08) ──
    0x2001: "LE_SET_EVENT_MASK",
    0x2003: "LE_READ_BUFFER_SIZE_V1",
    0x2005: "LE_READ_LOCAL_SUPPORTED_FEATURES",
    0x2007: "LE_SET_RANDOM_ADDRESS",
    0x2009: "LE_SET_ADVERTISING_PARAMETERS",
    0x200B: "LE_READ_ADVERTISING_PHYSICAL_CHANNEL_TX_POWER",
    0x200D: "LE_SET_ADVERTISING_DATA",
    0x200F: "LE_SET_SCAN_RESPONSE_DATA",
    0x2011: "LE_SET_ADVERTISING_ENABLE",
    0x2013: "LE_SET_SCAN_PARAMETERS",
    0x2015: "LE_SET_SCAN_ENABLE",
    0x2017: "LE_CREATE_CONNECTION",
    0x2019: "LE_CREATE_CONNECTION_CANCEL",
    0x201B: "LE_READ_WHITE_LIST_SIZE",
    0x201D: "LE_CLEAR_WHITE_LIST",
    0x201F: "LE_ADD_DEVICE_TO_WHITE_LIST",
    0x2021: "LE_REMOVE_DEVICE_FROM_WHITE_LIST",
    0x2023: "LE_CONNECTION_UPDATE",
    0x2025: "LE_SET_HOST_CHANNEL_CLASSIFICATION",
    0x2027: "LE_READ_CHANNEL_MAP",
    0x2029: "LE_READ_REMOTE_FEATURES",
    0x202B: "LE_ENCRYPT",
    0x202D: "LE_RAND",
    0x202F: "LE_START_ENCRYPTION",
    0x2031: "LE_REPLAY_ENCRYPTED_COMMAND",
    0x2033: "LE_LONG_TERM_KEY_REQUEST_REPLY",
    0x2035: "LE_LONG_TERM_KEY_REQUEST_NEGATIVE_REPLY",
    0x2037: "LE_READ_SUPPORTED_STATES",
    0x2039: "LE_RECEIVER_TEST_V1",
    0x203B: "LE_TRANSMITTER_TEST_V1",
    0x203D: "LE_TEST_END",
    0x2041: "LE_REMOTE_CONNECTION_PARAMETER_REQUEST_REPLY",
    0x2043: "LE_REMOTE_CONNECTION_PARAMETER_REQUEST_NEGATIVE_REPLY",
    0x2045: "LE_SET_DATA_LENGTH",
    0x2047: "LE_READ_SUGGESTED_DEFAULT_DATA_LENGTH",
    0x2049: "LE_WRITE_SUGGESTED_DEFAULT_DATA_LENGTH",
    0x204B: "LE_READ_LOCAL_P256_PUBLIC_KEY",
    0x204D: "LE_GENERATE_DHKEY_V1",
    0x204F: "LE_ADD_DEVICE_TO_RESOLVING_LIST",
    0x2051: "LE_REMOVE_DEVICE_FROM_RESOLVING_LIST",
    0x2053: "LE_CLEAR_RESOLVING_LIST",
    0x2055: "LE_READ_RESOLVING_LIST_SIZE",
    0x2057: "LE_READ_PEER_RESOLVABLE_ADDRESS",
    0x2059: "LE_READ_LOCAL_RESOLVABLE_ADDRESS",
    0x205B: "LE_SET_ADDRESS_RESOLUTION_ENABLE",
    0x205D: "LE_SET_RESOLVABLE_PRIVATE_ADDRESS_TIMEOUT",
    0x205F: "LE_READ_MAXIMUM_DATA_LENGTH",
    0x2061: "LE_READ_PHY",
    0x2063: "LE_SET_DEFAULT_PHY",
    0x2065: "LE_SET_PHY",
    0x2067: "LE_RECEIVER_TEST_V2",
    0x2069: "LE_TRANSMITTER_TEST_V2",
    0x206B: "LE_RECEIVER_TEST_V3",
    0x206D: "LE_TRANSMITTER_TEST_V3",
    0x206F: "LE_SET_ADVERTISING_SET_RANDOM_ADDRESS",
    0x2071: "LE_SET_EXTENDED_ADVERTISING_PARAMETERS",
    0x2073: "LE_SET_EXTENDED_ADVERTISING_DATA",
    0x2075: "LE_SET_EXTENDED_SCAN_RESPONSE_DATA",
    0x2077: "LE_SET_EXTENDED_ADVERTISING_ENABLE",
    0x2079: "LE_READ_MAXIMUM_ADVERTISING_DATA_LENGTH",
    0x207B: "LE_READ_NUMBER_OF_SUPPORTED_ADVERTISING_SETS",
    0x207D: "LE_REMOVE_ADVERTISING_SET",
    0x207F: "LE_CLEAR_ADVERTISING_SETS",
    0x2081: "LE_SET_PERIODIC_ADVERTISING_PARAMETERS",
    0x2083: "LE_SET_PERIODIC_ADVERTISING_DATA",
    0x2085: "LE_SET_PERIODIC_ADVERTISING_ENABLE",
    0x2087: "LE_SET_EXTENDED_SCAN_PARAMETERS",
    0x2089: "LE_SET_EXTENDED_SCAN_ENABLE",
    0x208B: "LE_EXTENDED_CREATE_CONNECTION",
    0x208D: "LE_PERIODIC_ADVERTISING_CREATE_SYNC",
    0x208F: "LE_PERIODIC_ADVERTISING_CREATE_SYNC_CANCEL",
    0x2091: "LE_PERIODIC_ADVERTISING_TERMINATE_SYNC",
    0x2093: "LE_ADD_DEVICE_TO_PERIODIC_ADVERTISER_LIST",
    0x2095: "LE_REMOVE_DEVICE_FROM_PERIODIC_ADVERTISER_LIST",
    0x2097: "LE_CLEAR_PERIODIC_ADVERTISER_LIST",
    0x2099: "LE_READ_PERIODIC_ADVERTISER_LIST_SIZE",
    0x209B: "LE_READ_TRANSMIT_POWER",
    0x209D: "LE_READ_RF_PATH_COMPENSATION",
    0x209F: "LE_WRITE_RF_PATH_COMPENSATION",
    0x20A1: "LE_SET_PRIVACY_MODE",
    0x20A3: "LE_RECEIVER_TEST_V4",
    0x20A5: "LE_TRANSMITTER_TEST_V4",
    0x20A7: "LE_READ_ANTENNA_INFORMATION",
    0x20A9: "LE_SET_CONNECTIONLESS_CTE_TRANSMIT_PARAMETERS",
    0x20AB: "LE_SET_CONNECTIONLESS_CTE_TRANSMIT_ENABLE",
    0x20AD: "LE_SET_CONNECTIONLESS_IQ_SAMPLING_ENABLE",
    0x20AF: "LE_SET_CONNECTION_CTE_RECEIVE_PARAMETERS",
    0x20B1: "LE_SET_CONNECTION_CTE_TRANSMIT_PARAMETERS",
    0x20B3: "LE_CONNECTION_CTE_REQUEST_ENABLE",
    0x20B5: "LE_CONNECTION_CTE_RESPONSE_ENABLE",
    0x20B7: "LE_READ_TRANSMIT_BUFFER_SIZE_V1",
    0x20B9: "LE_READ_TRANSMIT_BUFFER_SIZE_V2",
    0x20BB: "LE_READ_RECEIVE_BUFFER_SIZE_V1",
    0x20BD: "LE_SET_HOST_FEATURE",
    0x20BF: "LE_SET_CONTROLLER_FEATURE_COMMAND",
    0x20C1: "LE_READ_ISO_TX_SYNC",
    0x20C3: "LE_SET_CIG_PARAMETERS",
    0x20C5: "LE_SET_CIG_PARAMETERS_TEST",
    0x20C7: "LE_CREATE_CIS",
    0x20C9: "LE_REMOVE_CIG",
    0x20CB: "LE_ACCEPT_CIS_REQUEST",
    0x20CD: "LE_REJECT_CIS_REQUEST",
    0x20CF: "LE_CREATE_BIG",
    0x20D1: "LE_CREATE_BIG_TEST",
    0x20D3: "LE_TERMINATE_BIG",
    0x20D5: "LE_BIG_CREATE_SYNC",
    0x20D7: "LE_BIG_TERMINATE_SYNC",
    0x20D9: "LE_REQUEST_PEER_SCA",
    0x20DB: "LE_SETUP_ISO_DATA_PATH",
    0x20DD: "LE_REMOVE_ISO_DATA_PATH",
    0x20DF: "LE_ISO_TRANSMIT_TEST",
    0x20E1: "LE_ISO_RECEIVE_TEST",
    0x20E3: "LE_ISO_READ_TEST_COUNTERS",
    0x20E5: "LE_ISO_TEST_END",
    0x20E7: "LE_SET_HOST_CHANNEL_CLASSIFICATION",
    0x20E9: "LE_READ_ISO_LINK_QUALITY",
    0x20EB: "LE_READ_ENHANCED_TRANSMIT_POWER_LEVEL",
    0x20ED: "LE_READ_REMOTE_TRANSMIT_POWER_LEVEL",
    0x20EF: "LE_SET_PATH_LOSS_REPORTING_PARAMETERS",
    0x20F1: "LE_SET_PATH_LOSS_REPORTING_ENABLE",
    0x20F3: "LE_SET_TRANSMIT_POWER_REPORTING_ENABLE",
    0x20F7: "LE_TRANSMITTER_TEST_V5",
    0x20F9: "LE_SET_DATA_RELATED_ADDRESS_CHANGES",
    0x20FB: "LE_SET_DEFAULT_SUBRATE",
    0x20FD: "LE_SUBRATE_REQUEST",
    0x20FF: "LE_GENERATE_DHKEY_V2",
    0x2101: "LE_MODIFY_SLEEP_CLOCK_ACCURACY",
    0x2103: "LE_READ_BUFFER_SIZE_V2",
    # ── Common Vendor Commands ──
    0xFC09: "VENDOR_RESET_CHIP",
    0xFC1B: "VENDOR_SET_BDADDR",
    0xFC27: "VENDOR_DRIVER_DOWN",
    0xFC3B: "VENDOR_WRITE_UART_BAUD",
    0xFC4D: "VENDOR_HARDWARE_ERROR",
    0xFC63: "VENDOR_READ_CHIP_TYPE",
    0xFC82: "VENDOR_SET_SCO_ROUTING",
}

# ── HCI Event Code → Name Lookup ──────────────────────────────────────
HCI_EVENTS: dict[int, str] = {
    0x01: "INQUIRY_COMPLETE",
    0x02: "INQUIRY_RESULT",
    0x03: "CONNECTION_COMPLETE",
    0x04: "CONNECTION_REQUEST",
    0x05: "DISCONNECTION_COMPLETE",
    0x06: "AUTHENTICATION_COMPLETE",
    0x07: "REMOTE_NAME_REQUEST_COMPLETE",
    0x08: "ENCRYPTION_CHANGE",
    0x09: "CHANGE_CONNECTION_LINK_KEY_COMPLETE",
    0x0A: "MASTER_LINK_KEY_COMPLETE",
    0x0B: "READ_REMOTE_SUPPORTED_FEATURES_COMPLETE",
    0x0C: "READ_REMOTE_VERSION_INFORMATION_COMPLETE",
    0x0D: "QOS_SETUP_COMPLETE",
    0x0E: "COMMAND_COMPLETE",
    0x0F: "COMMAND_STATUS",
    0x10: "HARDWARE_ERROR",
    0x11: "FLUSH_OCCURRED",
    0x12: "ROLE_CHANGE",
    0x13: "NUMBER_OF_COMPLETED_PACKETS",
    0x14: "MODE_CHANGE",
    0x15: "RETURN_LINK_KEYS",
    0x16: "PIN_CODE_REQUEST",
    0x17: "LINK_KEY_REQUEST",
    0x18: "LINK_KEY_NOTIFICATION",
    0x19: "LOOPBACK_COMMAND",
    0x1A: "DATA_BUFFER_OVERFLOW",
    0x1B: "MAX_SLOTS_CHANGE",
    0x1C: "READ_CLOCK_OFFSET_COMPLETE",
    0x1D: "CONNECTION_PACKET_TYPE_CHANGED",
    0x1E: "QOS_VIOLATION",
    0x1F: "PAGE_SCAN_MODE_CHANGE",
    0x20: "PAGE_SCAN_REPETITION_MODE_CHANGE",
    0x21: "FLOW_SPECIFICATION_COMPLETE",
    0x22: "INQUIRY_RESULT_WITH_RSSI",
    0x23: "READ_REMOTE_EXTENDED_FEATURES_COMPLETE",
    0x2C: "SYNCHRONOUS_CONNECTION_COMPLETE",
    0x2D: "SYNCHRONOUS_CONNECTION_CHANGED",
    0x2E: "SNIFF_SUBRATING",
    0x2F: "EXTENDED_INQUIRY_RESULT",
    0x30: "ENCRYPTION_KEY_REFRESH_COMPLETE",
    0x31: "IO_CAPABILITY_REQUEST",
    0x32: "IO_CAPABILITY_RESPONSE",
    0x33: "USER_CONFIRMATION_REQUEST",
    0x34: "USER_PASSKEY_REQUEST",
    0x35: "REMOTE_OOB_DATA_REQUEST",
    0x36: "SIMPLE_PAIRING_COMPLETE",
    0x37: "LINK_SUPERVISION_TIMEOUT_CHANGED",
    0x38: "ENHANCED_FLUSH_COMPLETE",
    0x39: "USER_PASSKEY_NOTIFICATION",
    0x3A: "KEYPRESS_NOTIFICATION",
    0x3B: "REMOTE_HOST_SUPPORTED_FEATURES_NOTIFICATION",
    0x3E: "LE_META_EVENT",
    0x40: "PHYSICAL_LINK_COMPLETE",
    0x41: "CHANNEL_SELECTED",
    0x42: "DISCONNECTION_PHYSICAL_LINK_COMPLETE",
    0x43: "PHYSICAL_LINK_LOSS_EARLY_WARNING",
    0x44: "PHYSICAL_LINK_RECOVERY",
    0x45: "LOGICAL_LINK_COMPLETE",
    0x46: "DISCONNECTION_LOGICAL_LINK_COMPLETE",
    0x47: "FLOW_SPEC_MODIFY_COMPLETE",
    0x48: "NUMBER_OF_COMPLETED_DATA_BLOCKS",
    0x49: "AMP_START_TEST",
    0x4A: "AMP_TEST_END",
    0x4B: "AMP_RECEIVER_REPORT",
    0x4C: "SHORT_RANGE_MODE_CHANGE_COMPLETE",
    0x4D: "AMP_STATUS_CHANGE",
    0x4E: "TRIGGERED_CLOCK_CAPTURE",
    0x4F: "SYNCHRONIZATION_TRAIN_COMPLETE",
    0x50: "SYNCHRONIZATION_TRAIN_RECEIVED",
    0x51: "CONNECTIONLESS_SLAVE_BROADCAST_RECEIVE",
    0x52: "CONNECTIONLESS_SLAVE_BROADCAST_TIMEOUT",
    0x53: "TRUNCATED_PAGE_COMPLETE",
    0x54: "SLAVE_PAGE_RESPONSE_TIMEOUT",
    0x55: "CONNECTIONLESS_SLAVE_BROADCAST_CHANNEL_MAP_CHANGE",
    0x56: "INQUIRY_RESPONSE_NOTIFICATION",
    0x57: "AUTHENTICATED_PAYLOAD_TIMEOUT_EXPIRED",
    0x58: "SAM_STATUS_CHANGE",
    0x5C: "LE_CONNECTIONLESS_IQ_REPORT",
    0x5D: "LE_CONNECTION_IQ_REPORT",
    0x5E: "LE_CTE_REQUEST_FAILED",
    0x5F: "LE_PERIODIC_ADVERTISING_SYNC_ESTABLISHED_V1",
    0x60: "LE_PERIODIC_ADVERTISING_REPORT",
    0x61: "LE_PERIODIC_ADVERTISING_SYNC_LOST",
    0x62: "LE_SCAN_TIMEOUT",
    0x63: "LE_ADVERTISING_SET_TERMINATED",
    0x64: "LE_SCAN_REQUEST_RECEIVED",
    0x65: "LE_CHANNEL_SELECTION_ALGORITHM",
    0x66: "LE_CONNECTIONLESS_IQ_REPORT_V2",
    0x67: "LE_CONNECTION_IQ_REPORT_V2",
    0x68: "LE_CTE_REQUEST_FAILED_V2",
    0x69: "LE_PERIODIC_ADVERTISING_SYNC_ESTABLISHED_V2",
    0x6A: "LE_PERIODIC_ADVERTISING_REPORT_V2",
    0x6B: "LE_BIG_INFO_ADVERTISING_REPORT",
    0x6C: "LE_BIG_COMPLETE",
    0x6D: "LE_BIG_TERMINATED",
    0x6E: "LE_BIG_SYNC_ESTABLISHED",
    0x6F: "LE_BIG_SYNC_LOST",
    0x70: "LE_REQUEST_PEER_SCA_COMPLETE",
    0x71: "LE_CIS_ESTABLISHED_V1",
    0x72: "LE_CIS_REQUEST",
    0x73: "LE_CREATE_BIG_COMPLETE",
    0x74: "LE_TERMINATE_BIG_COMPLETE",
    0x75: "LE_BIG_SYNC_ESTABLISHED_V2",
    0x76: "LE_BIG_SYNC_LOST_V2",
    0x77: "LE_TRANSMIT_POWER_REPORTING",
    0x78: "LE_BIG_INFO_ADVERTISING_REPORT_V2",
    0x79: "LE_SUBRATE_CHANGE",
    0x7A: "LE_CIS_ESTABLISHED_V2",
    0xFE: "VENDOR_DEBUG_EVENT",
    0xFF: "VENDOR_SPECIFIC_EVENT",
}

# ── LE Sub-event codes (for LE_META_EVENT 0x3E) ───────────────────────
LE_SUB_EVENTS: dict[int, str] = {
    0x01: "LE_CONNECTION_COMPLETE",
    0x02: "LE_ADVERTISING_REPORT",
    0x03: "LE_CONNECTION_UPDATE_COMPLETE",
    0x04: "LE_READ_REMOTE_FEATURES_COMPLETE",
    0x05: "LE_LONG_TERM_KEY_REQUEST",
    0x06: "LE_REMOTE_CONNECTION_PARAMETER_REQUEST",
    0x07: "LE_DATA_LENGTH_CHANGE",
    0x08: "LE_READ_LOCAL_P256_PUBLIC_KEY_COMPLETE",
    0x09: "LE_GENERATE_DHKEY_COMPLETE",
    0x0A: "LE_ENHANCED_CONNECTION_COMPLETE",
    0x0B: "LE_DIRECT_ADVERTISING_REPORT",
    0x0C: "LE_PHY_UPDATE_COMPLETE",
    0x0D: "LE_EXTENDED_ADVERTISING_REPORT",
    0x0E: "LE_PERIODIC_ADVERTISING_SYNC_ESTABLISHED",
    0x0F: "LE_PERIODIC_ADVERTISING_REPORT",
    0x10: "LE_PERIODIC_ADVERTISING_SYNC_LOST",
    0x11: "LE_SCAN_TIMEOUT",
    0x12: "LE_ADVERTISING_SET_TERMINATED",
    0x13: "LE_SCAN_REQUEST_RECEIVED",
    0x14: "LE_CHANNEL_SELECTION_ALGORITHM",
    0x15: "LE_CONNECTIONLESS_IQ_REPORT",
    0x16: "LE_CONNECTION_IQ_REPORT",
    0x17: "LE_CTE_REQUEST_FAILED",
    0x18: "LE_PERIODIC_ADVERTISING_SYNC_TRANSFER_RECEIVED",
    0x19: "LE_CIS_ESTABLISHED",
    0x1A: "LE_CIS_REQUEST",
    0x1B: "LE_CREATE_BIG_COMPLETE",
    0x1C: "LE_TERMINATE_BIG_COMPLETE",
    0x1D: "LE_BIG_SYNC_ESTABLISHED",
    0x1E: "LE_BIG_SYNC_LOST",
    0x1F: "LE_REQUEST_PEER_SCA_COMPLETE",
    0x20: "LE_PATH_LOSS_REPORTING",
    0x21: "LE_TRANSMIT_POWER_REPORTING",
    0x22: "LE_BIG_INFO_ADVERTISING_REPORT",
    0x23: "LE_SUBRATE_CHANGE",
}


# ── Data structures ────────────────────────────────────────────────────


@dataclass
class HciEntry:
    """A single HCI packet from a BTSnoop file."""

    packet_number: int
    timestamp: str | None
    direction: str  # "HOST_TO_CONTROLLER" or "CONTROLLER_TO_HOST"
    hci_type: str  # "COMMAND", "EVENT", "ACL_DATA", "SCO_DATA", "ISO_DATA"
    opcode: int | None  # For Command packets: (OGF << 10) | OCF
    opcode_name: str | None  # Human-readable command name
    event_code: int | None  # For Event packets
    event_name: str | None  # Human-readable event name
    data_length: int
    raw_summary: str
    source_file: str | None = None


@dataclass
class HciFilters:
    """Filter criteria for HCI entries."""

    start_time: str | None = None
    end_time: str | None = None
    direction: str | None = None  # "HOST_TO_CONTROLLER" | "CONTROLLER_TO_HOST"
    hci_type: str | None = None  # "COMMAND" | "EVENT" | "ACL_DATA" | "SCO_DATA" | "ISO_DATA"
    opcode: int | None = None
    opcode_name: str | None = None  # Substring match
    event_code: int | None = None
    event_name: str | None = None  # Substring match
    keywords: str | None = None  # Search in raw_summary


@dataclass
class HciStatistics:
    """Statistics about parsed HCI entries."""

    total: int
    by_direction: dict[str, int]
    by_type: dict[str, int]
    duration_seconds: float | None
    unique_opcodes: int


@dataclass
class HciParseResult:
    """Result of parsing an HCI (BTSnoop) file."""

    entries: list[HciEntry]
    total_packets: int
    format_detected: str  # "btsnoop"
    file_size: int


def _decode_opcode(opcode: int) -> tuple[int, int, str]:
    """Decode an HCI command opcode into (OGF, OCF, name).

    Returns (ogf, ocf, human_readable_name).
    """
    ogf = (opcode >> 10) & 0x3F
    ocf = opcode & 0x3FF
    name = HCI_OPCODES.get(opcode)
    if name is None:
        group = OGF_NAMES.get(ogf, "UNKNOWN")
        name = f"{group}_0x{opcode:04X}" if ogf != 0x3F else f"VENDOR_0x{opcode:04X}"
    return ogf, ocf, name


def _decode_event(event_code: int, payload: bytes | None = None) -> str:
    """Decode an HCI event code into a human-readable name.

    For LE_META_EVENT (0x3E), inspects the first payload byte for the
    sub-event code.
    """
    name = HCI_EVENTS.get(event_code)
    if name is None:
        return f"UNKNOWN_EVENT_0x{event_code:02X}"

    if event_code == 0x3E and payload and len(payload) > 0:
        sub_code = payload[0]
        sub_name = LE_SUB_EVENTS.get(sub_code)
        if sub_name:
            return f"LE_META: {sub_name}"
        return f"LE_META: UNKNOWN_SUB_0x{sub_code:02X}"

    return name


# ── Analyzer ────────────────────────────────────────────────────────────


class HciAnalyzer:
    """Analyzer for Bluetooth HCI (BTSnoop format) log files."""

    @staticmethod
    def _is_hci_data(data: bytes) -> bool:
        """Check if data starts with BTSnoop magic bytes."""
        return len(data) >= 8 and data[:8] == BTSNOOP_MAGIC

    @staticmethod
    def _parse_header(data: bytes, offset: int = 0) -> tuple[int, int, int]:
        """Parse BTSnoop file header.

        Returns (version, data_link_type, header_end_offset).
        Raises ValueError if data is not a valid BTSnoop file.
        """
        if len(data) - offset < 16:
            raise ValueError("File too small for BTSnoop header (minimum 16 bytes)")

        magic = data[offset : offset + 8]
        if magic != BTSNOOP_MAGIC:
            raise ValueError(
                f"Invalid BTSnoop magic bytes: expected b'btsnoop\\x00', got {magic!r}"
            )

        version = struct.unpack_from(">I", data, offset + 8)[0]
        data_link_type = struct.unpack_from(">I", data, offset + 12)[0]

        return version, data_link_type, offset + 16

    @staticmethod
    def _parse_packet_record(data: bytes, offset: int) -> tuple[dict, int] | None:
        """Parse a single BTSnoop packet record header.

        Returns (record_dict, next_offset) or None if insufficient data.
        record_dict contains: original_length, included_length, packet_flags,
        cumulative_drops, timestamp_us, direction, hci_type.
        """
        if len(data) - offset < 24:
            return None

        original_length = struct.unpack_from(">I", data, offset)[0]
        included_length = struct.unpack_from(">I", data, offset + 4)[0]
        packet_flags = struct.unpack_from(">I", data, offset + 8)[0]
        cumulative_drops = struct.unpack_from(">I", data, offset + 12)[0]
        timestamp_us = struct.unpack_from(">Q", data, offset + 16)[0]

        # Direction: bit 0 (0 = Host→Controller, 1 = Controller→Host)
        direction = (
            DIRECTION_CONTROLLER_TO_HOST if (packet_flags & 0x01) else DIRECTION_HOST_TO_CONTROLLER
        )

        # HCI type: bits 2-3 for standard types, bit 4 for ISO
        if packet_flags & 0x10:  # Bit 4 set = ISO data (Bluetooth 5.2+)
            hci_type = HCI_TYPE_ISO
        else:
            hci_type = (packet_flags >> 2) & 0x03

        hci_type_name = HCI_TYPE_NAMES.get(hci_type, f"UNKNOWN_{hci_type}")

        payload_start = offset + 24
        payload_end = payload_start + min(included_length, len(data) - payload_start)
        payload = data[payload_start:payload_end]

        return {
            "original_length": original_length,
            "included_length": included_length,
            "packet_flags": packet_flags,
            "cumulative_drops": cumulative_drops,
            "timestamp_us": timestamp_us,
            "direction": direction,
            "hci_type": hci_type_name,
            "payload": payload,
            "next_offset": offset + 24 + original_length,
        }, offset

    @staticmethod
    def _us_to_timestamp(timestamp_us: int) -> str:
        """Convert BTSnoop microseconds timestamp to ISO-format string.

        Uses Unix epoch (Android convention). Filters out clearly invalid
        timestamps from the epoch-0 convention used by some tools.
        """
        # BTSnoop spec says microseconds since Jan 1, 0 AD, but Android
        # uses Unix epoch. If the value is larger than the year 2500 in
        # Unix microseconds, it's likely using the AD 0 epoch — apply a
        # correction to convert to Unix epoch.
        max_unix_us = 17000000000000000  # ~ year 2508

        if timestamp_us > max_unix_us:
            # Likely epoch-0; offset to Unix epoch (Jan 1 1970)
            timestamp_us -= 62135596800000000

        try:
            ts_sec = timestamp_us / 1_000_000.0
            dt = datetime.fromtimestamp(ts_sec, tz=UTC)
            return dt.strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
        except (OSError, ValueError, OverflowError):
            return f"ts={timestamp_us}us"

    @staticmethod
    def _payload_to_hex_str(payload: bytes, max_bytes: int = 64) -> str:
        """Convert payload bytes to a hex+ASCII summary string."""
        if not payload:
            return "(empty)"

        truncated = payload[:max_bytes]
        hex_part = truncated.hex(" ").upper()
        # ASCII representation
        ascii_part = "".join(chr(b) if 0x20 <= b < 0x7F else "." for b in truncated)
        suffix = "..." if len(payload) > max_bytes else ""
        return f"{hex_part}  |{ascii_part}|{suffix}"

    def _record_to_entry(
        self,
        record: dict,
        packet_number: int,
        source_file: str | None = None,
    ) -> HciEntry:
        """Convert a parsed packet record dict to an HciEntry."""
        payload = record["payload"]
        hci_type = record["hci_type"]
        timestamp = self._us_to_timestamp(record["timestamp_us"])

        opcode = None
        opcode_name = None
        event_code = None
        event_name = None
        summary_parts = [f"#{packet_number}", record["direction"], hci_type]

        if hci_type == "COMMAND" and len(payload) >= 2:
            opcode = struct.unpack_from("<H", payload, 0)[0]
            _, _, name = _decode_opcode(opcode)
            opcode_name = name
            summary_parts.append(f"0x{opcode:04X} ({name})")
        elif hci_type == "EVENT" and len(payload) >= 1:
            event_code = payload[0]
            event_name = _decode_event(event_code, payload[1:2] if len(payload) > 1 else None)
            summary_parts.append(f"Evt 0x{event_code:02X} ({event_name})")

        summary_parts.append(f"len={len(payload)}")
        raw_summary = " | ".join(summary_parts) + "\n" + self._payload_to_hex_str(payload)

        return HciEntry(
            packet_number=packet_number,
            timestamp=timestamp,
            direction=record["direction"],
            hci_type=hci_type,
            opcode=opcode,
            opcode_name=opcode_name,
            event_code=event_code,
            event_name=event_name,
            data_length=len(payload),
            raw_summary=raw_summary,
            source_file=source_file,
        )

    # ── Public API ──────────────────────────────────────────────────────

    def parse_hci(self, data: bytes, filename: str = "btsnoop_hci.log") -> HciParseResult:
        """Parse a BTSnoop file from raw bytes."""
        data, filename = self._decompress(data, filename)

        if not self._is_hci_data(data):
            raise ValueError("File does not appear to be a valid BTSnoop (HCI) file")

        entries = list(self._parse_hci_bytes_iter(data, filename))

        return HciParseResult(
            entries=entries,
            total_packets=len(entries),
            format_detected="btsnoop",
            file_size=len(data),
        )

    def stream_hci(self, data: bytes, filename: str = "btsnoop_hci.log") -> Iterator[HciEntry]:
        """Stream HCI packets from a BTSnoop file one by one."""
        data, filename = self._decompress(data, filename)

        if not self._is_hci_data(data):
            raise ValueError("File does not appear to be a valid BTSnoop (HCI) file")

        yield from self._parse_hci_bytes_iter(data, filename)

    def _parse_hci_bytes_iter(
        self, data: bytes, source_file: str | None = None
    ) -> Iterator[HciEntry]:
        """Parse BTSnoop bytes and yield HciEntry objects one by one."""
        _, _, offset = self._parse_header(data, 0)
        packet_number = 0

        while True:
            if offset >= len(data):
                break
            result = self._parse_packet_record(data, offset)
            if result is None:
                break
            record, _ = result
            packet_number += 1
            yield self._record_to_entry(record, packet_number, source_file)
            offset = record["next_offset"]

    def filter_hci(self, entries: list[HciEntry], filters: HciFilters) -> list[HciEntry]:
        """Apply filters to a list of HCI entries."""
        result = entries

        if filters.direction:
            result = [e for e in result if e.direction == filters.direction]

        if filters.hci_type:
            result = [e for e in result if e.hci_type == filters.hci_type]

        if filters.opcode is not None:
            result = [e for e in result if e.opcode == filters.opcode]

        if filters.opcode_name:
            name_upper = filters.opcode_name.upper()
            result = [e for e in result if e.opcode_name and name_upper in e.opcode_name.upper()]

        if filters.event_code is not None:
            result = [e for e in result if e.event_code == filters.event_code]

        if filters.event_name:
            ename_upper = filters.event_name.upper()
            result = [e for e in result if e.event_name and ename_upper in e.event_name.upper()]

        if filters.keywords:
            kw = filters.keywords.lower()
            result = [e for e in result if kw in e.raw_summary.lower()]

        if filters.start_time:
            result = [e for e in result if e.timestamp and e.timestamp >= filters.start_time]

        if filters.end_time:
            result = [e for e in result if e.timestamp and e.timestamp <= filters.end_time]

        return result

    def compute_statistics(self, entries: list[HciEntry]) -> HciStatistics:
        """Compute statistics for a list of HCI entries."""
        if not entries:
            return HciStatistics(
                total=0,
                by_direction={},
                by_type={},
                duration_seconds=None,
                unique_opcodes=0,
            )

        by_direction: dict[str, int] = {}
        by_type: dict[str, int] = {}
        opcodes: set[int] = set()

        for entry in entries:
            by_direction[entry.direction] = by_direction.get(entry.direction, 0) + 1
            by_type[entry.hci_type] = by_type.get(entry.hci_type, 0) + 1
            if entry.opcode is not None:
                opcodes.add(entry.opcode)

        duration_seconds = None
        timestamps = [e.timestamp for e in entries if e.timestamp]
        if len(timestamps) >= 2:
            try:
                parsed = [datetime.strptime(ts, "%Y-%m-%d %H:%M:%S.%f") for ts in timestamps]
                duration_seconds = (max(parsed) - min(parsed)).total_seconds()
            except (ValueError, IndexError):
                pass

        return HciStatistics(
            total=len(entries),
            by_direction=by_direction,
            by_type=by_type,
            duration_seconds=duration_seconds,
            unique_opcodes=len(opcodes),
        )

    @staticmethod
    def _match_entry(entry: HciEntry, filters: HciFilters) -> bool:
        """Check if a single HciEntry matches all given filters."""
        if filters.direction:
            if entry.direction != filters.direction:
                return False

        if filters.hci_type:
            if entry.hci_type != filters.hci_type:
                return False

        if filters.opcode is not None:
            if entry.opcode != filters.opcode:
                return False

        if filters.opcode_name:
            if not entry.opcode_name:
                return False
            if filters.opcode_name.upper() not in entry.opcode_name.upper():
                return False

        if filters.event_code is not None:
            if entry.event_code != filters.event_code:
                return False

        if filters.event_name:
            if not entry.event_name:
                return False
            if filters.event_name.upper() not in entry.event_name.upper():
                return False

        if filters.keywords:
            kw = filters.keywords.lower()
            if kw not in entry.raw_summary.lower():
                return False

        if filters.start_time and entry.timestamp:
            if entry.timestamp < filters.start_time:
                return False

        if filters.end_time and entry.timestamp:
            if entry.timestamp > filters.end_time:
                return False

        return True

    def stream_filter_from_path(
        self, path: str, filters: HciFilters | None = None
    ) -> Iterator[HciEntry]:
        """Stream filtered packets from a BTSnoop file on disk."""
        real_path = os.path.realpath(path)
        if not os.path.isfile(real_path):
            raise FileNotFoundError(f"HCI file not found: {real_path}")

        lower = real_path.lower()

        if lower.endswith(".gz"):
            with gzip.open(real_path, "rb") as fh:
                data = fh.read()
            try:
                decompressed, _ = self._decompress(data, os.path.basename(real_path))
            except ValueError:
                decompressed = data
            source_file = os.path.basename(real_path)
            for entry in self._parse_hci_bytes_iter(decompressed, source_file):
                if filters is None or self._match_entry(entry, filters):
                    yield entry
            return

        if lower.endswith(".zip"):
            with open(real_path, "rb") as fh:
                data = fh.read()
            try:
                decompressed, source_name = self._decompress(data, os.path.basename(real_path))
            except ValueError:
                raise ValueError("No HCI file found in zip archive")
            for entry in self._parse_hci_bytes_iter(decompressed, source_name):
                if filters is None or self._match_entry(entry, filters):
                    yield entry
            return

        with open(real_path, "rb") as fh:
            magic = fh.read(8)
        if not self._is_hci_data(magic):
            raise ValueError("File does not appear to be a valid BTSnoop (HCI) file")

        with open(real_path, "rb") as fh:
            data = fh.read()

        source_file = os.path.basename(real_path)
        for entry in self._parse_hci_bytes_iter(data, source_file):
            if filters is None or self._match_entry(entry, filters):
                yield entry

    @staticmethod
    def _decompress(data: bytes, filename: str) -> tuple[bytes, str]:
        """Handle .gz and .zip compression, returning (data, filename)."""
        if filename.lower().endswith(".gz"):
            try:
                data = gzip.decompress(data)
                filename = filename[:-3]
            except gzip.BadGzipFile as exc:
                raise ValueError(f"Invalid gzip file: {exc}") from exc

        if filename.lower().endswith(".zip"):
            try:
                with zipfile.ZipFile(io.BytesIO(data)) as zf:
                    hci_extensions = (".log", ".hci", ".btsnoop", ".cfa")
                    for info in zf.infolist():
                        if info.filename.lower().endswith(hci_extensions):
                            data = zf.read(info.filename)
                            filename = info.filename
                            break
                    else:
                        raise ValueError("No .log/.hci/.btsnoop/.cfa file found in zip archive")
            except zipfile.BadZipFile as exc:
                raise ValueError(f"Invalid ZIP file: {exc}") from exc

        return data, filename
