export interface PcapEntry {
  packet_number: number
  timestamp: string | null
  protocol: string
  src_ip: string
  dst_ip: string
  src_port: number | null
  dst_port: number | null
  length: number
  tcp_flags: string | null
  info: string
  raw_summary: string
  source_file: string | null
}

export interface PcapFilters {
  start_time: string | null
  end_time: string | null
  protocol: string | null
  src_ip: string | null
  dst_ip: string | null
  src_port: number | null
  dst_port: number | null
  tcp_flags: string | null
  keywords: string | null
}

export interface PcapStatistics {
  total: number
  by_protocol: Record<string, number>
  unique_ips: number
  unique_connections: number
  duration_seconds: number | null
}
