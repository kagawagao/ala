export interface HciEntry {
  packet_number: number
  timestamp: string | null
  direction: string
  hci_type: string
  opcode: number | null
  opcode_name: string | null
  event_code: number | null
  event_name: string | null
  data_length: number
  raw_summary: string
  source_file: string | null
}

export interface HciFilters {
  start_time: string | null
  end_time: string | null
  direction: string | null
  hci_type: string | null
  opcode: number | null
  opcode_name: string | null
  event_code: number | null
  event_name: string | null
  keywords: string | null
}

export interface HciStatistics {
  total: number
  by_direction: Record<string, number>
  by_type: Record<string, number>
  duration_seconds: number | null
  unique_opcodes: number
}
