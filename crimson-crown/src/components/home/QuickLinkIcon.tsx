import {
  Crown,
  Heart,
  Package,
  Search,
  ShoppingBag,
  Sparkles,
  Tag,
  Truck,
  type LucideIcon,
} from 'lucide-react'

import type { QuickLinkIconKey } from '@/lib/home/quick-links'

const ICONS: Record<QuickLinkIconKey, LucideIcon> = {
  sparkles: Sparkles,
  crown: Crown,
  package: Package,
  'shopping-bag': ShoppingBag,
  search: Search,
  tag: Tag,
  heart: Heart,
  truck: Truck,
}

export function QuickLinkIcon({ iconKey, size = 24 }: { iconKey: QuickLinkIconKey; size?: number }) {
  const Icon = ICONS[iconKey] || Sparkles
  return <Icon size={size} aria-hidden="true" />
}
