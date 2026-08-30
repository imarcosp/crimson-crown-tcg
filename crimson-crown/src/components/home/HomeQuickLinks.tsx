import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'

import { QuickLinkIcon } from '@/components/home/QuickLinkIcon'
import type { HomeQuickLinkRecord } from '@/lib/home/quick-links'

function QuickLinkContent({ quickLink }: { quickLink: HomeQuickLinkRecord }) {
  if (quickLink.image_url) {
    return (
      <>
        {/* Public promotional assets come from the validated banners bucket. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={quickLink.image_url} alt="" className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.025]" />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-slate-950/25 to-transparent" />
        <div className="relative flex min-h-28 items-end justify-between gap-3 p-4 text-white sm:min-h-32">
          <span className="text-base font-extrabold leading-tight drop-shadow-sm">{quickLink.label}</span>
          <ArrowUpRight size={18} className="shrink-0 opacity-80" aria-hidden="true" />
        </div>
      </>
    )
  }

  return (
    <div className="flex min-h-28 items-center gap-4 p-4 sm:min-h-32 sm:p-5">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#9D1B1B]/10 text-[#9D1B1B] transition-colors group-hover:bg-[#9D1B1B] group-hover:text-white">
        <QuickLinkIcon iconKey={quickLink.icon_key} size={22} />
      </span>
      <span className="min-w-0 flex-1 text-base font-extrabold leading-tight text-slate-900">{quickLink.label}</span>
      <ArrowUpRight size={18} className="shrink-0 text-slate-400 transition-colors group-hover:text-[#9D1B1B]" aria-hidden="true" />
    </div>
  )
}

export default function HomeQuickLinks({ quickLinks }: { quickLinks: HomeQuickLinkRecord[] }) {
  if (quickLinks.length === 0) return null

  return (
    <nav aria-label="Accesos rápidos" data-testid="home-quick-links">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {quickLinks.map((quickLink) => {
          const className = 'group relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9D1B1B] focus-visible:ring-offset-2'
          const isExternal = /^https?:\/\//iu.test(quickLink.url)
          if (isExternal) {
            return (
              <a key={quickLink.id} href={quickLink.url} target="_blank" rel="noreferrer" className={className}>
                <QuickLinkContent quickLink={quickLink} />
              </a>
            )
          }
          return (
            <Link key={quickLink.id} href={quickLink.url} className={className}>
              <QuickLinkContent quickLink={quickLink} />
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
