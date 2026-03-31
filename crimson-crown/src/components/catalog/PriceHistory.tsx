"use client"
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

type Props = {
  data: { price: number; created_at: string }[]
}

export default function PriceHistory({ data }: Props) {
  if (!data || data.length < 2) return null // No mostramos gráfico si hay pocos datos

  // Procesamos datos para el gráfico
  const chartData = data.map(d => ({
    date: new Date(d.created_at),
    price: d.price
  }))

  return (
    <div className="mt-6 p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
      <h3 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2">
        📉 Historial de Precio
      </h3>
      <div className="h-48 w-full text-xs">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#E91E63" stopOpacity={0.1}/>
                <stop offset="95%" stopColor="#E91E63" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <XAxis 
                dataKey="date" 
                tickFormatter={(date) => format(date, 'dd MMM', { locale: es })}
                minTickGap={30}
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#94a3b8' }}
            />
            <YAxis 
                domain={['auto', 'auto']} 
                orientation="right" 
                tickFormatter={(val) => `$${val}`}
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#94a3b8' }}
                width={40}
            />
            <Tooltip 
                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                labelFormatter={(date) => format(date as Date, 'dd MMMM yyyy', { locale: es })}
                formatter={(value: number) => [`US$ ${value.toFixed(2)}`, 'Precio']}
            />
            <Area 
                type="monotone" 
                dataKey="price" 
                stroke="#E91E63" 
                strokeWidth={2}
                fillOpacity={1} 
                fill="url(#colorPrice)" 
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}