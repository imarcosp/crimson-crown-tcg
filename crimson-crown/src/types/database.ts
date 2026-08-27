export interface DatabaseProduct {
  id: string
  name: string
  set_name: string
  collector_number: string
  tcg: string
  price_usd: number
  stock: number
  condition: string
  finish: string
  rarity: string
  image_url: string
  inventory_id: string
  variant_key: string
  is_manual_price: boolean
  inventory_kind?: 'primary' | 'secondary'
  inventory_count?: number
  pricing_source?: 'cardkingdom' | 'tcgplayer' | 'manual' | 'unknown'
}

export interface Inventory {
  id: string
  name: string
  description: string | null
  location_label: string | null
  kind: 'primary' | 'secondary'
  is_active: boolean
  created_at: string
  updated_at: string
  archived_at: string | null
}

export interface InventoryOffer {
  product_id: string
  inventory_id: string
  variant_key: string
  quantity: number
  price_usd: number
  pricing_source: 'cardkingdom' | 'tcgplayer' | 'manual' | 'unknown'
}

export interface InventoryMetric {
  inventory_id: string
  inventory_name: string
  inventory_kind: 'primary' | 'secondary'
  is_active: boolean
  archived_at: string | null
  available_units: number
  variant_count: number
  stock_value: number
  reserved_units: number
  sold_units: number
  sold_revenue: number
  cancelled_units: number
  cancelled_revenue: number
}
