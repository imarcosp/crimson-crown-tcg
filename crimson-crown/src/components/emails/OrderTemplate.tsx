import * as React from 'react';
import { Html, Body, Head, Heading, Hr, Container, Preview, Section, Text, Column, Row } from '@react-email/components';
import { siteConfig } from '@/config/site';

export const OrderTemplate = ({ orderId, items, total, totalArs, type }: any) => {
  const arsFormatted = totalArs 
    ? new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(totalArs)
    : null

  return (
    <Html>
      <Head />
      <Preview>{type === 'customer' ? 'Tu orden está confirmada' : '💰 Nueva Venta Recibida'}</Preview>
      <Body style={{ backgroundColor: '#ffffff', fontFamily: 'sans-serif', color: '#333' }}>
        <Container style={{ margin: '0 auto', padding: '20px 0 48px', maxWidth: '580px' }}>
          
          <Heading style={{ color: '#0F172A', fontSize: '24px', fontWeight: 'bold', margin: '0 0 10px 0' }}>
            {type === 'customer' ? '¡Gracias por tu compra!' : '💰 Nueva Venta Detectada'}
          </Heading>
          
          <Text style={{ margin: '0 0 20px 0', fontSize: '14px', color: '#666' }}>
            Orden: <strong>#{orderId.slice(0, 8)}</strong>
          </Text>
          
          <Hr style={{ borderColor: '#e6ebf1', margin: '20px 0' }} />
          
          <Section>
            {items.map((item: any, index: number) => (
              <Row key={index} style={{ marginBottom: '10px' }}>
                <Column style={{ width: '70%' }}>
                  <Text style={{ margin: 0, fontSize: '14px' }}>
                    <strong>{item.quantity}x</strong> {item.name}
                  </Text>
                </Column>
                <Column style={{ width: '30%', textAlign: 'right' }}>
                  <Text style={{ margin: 0, fontSize: '14px', fontWeight: 'bold' }}>
                    US$ {Number(item.price).toFixed(2)}
                  </Text>
                </Column>
              </Row>
            ))}
          </Section>
          
          <Hr style={{ borderColor: '#e6ebf1', margin: '20px 0' }} />
          
          {/* TOTALES */}
          <Section>
            <Row>
              <Column style={{ textAlign: 'right' }}>
                <Text style={{ margin: 0, fontSize: '14px', color: '#64748b' }}>Total en Dólares:</Text>
                <Text style={{ margin: '4px 0 0 0', fontSize: '18px', fontWeight: 'bold', color: '#0F172A' }}>
                  US$ {Number(total).toFixed(2)}
                </Text>
              </Column>
            </Row>
            {/* Si existe total en ARS, lo mostramos */}
            {totalArs > 0 && (
              <Row style={{ marginTop: '12px' }}>
                <Column style={{ textAlign: 'right' }}>
                  <Text style={{ margin: 0, fontSize: '14px', color: '#64748b' }}>Total en Pesos:</Text>
                  <Text style={{ margin: '4px 0 0 0', fontSize: '24px', fontWeight: 'bold', color: '#9D1B1B' }}>
                    {arsFormatted}
                  </Text>
                </Column>
              </Row>
            )}
          </Section>

          {/* DATOS BANCARIOS (Solo para el Cliente) */}
          {type === 'customer' && (
            <Section style={{ marginTop: '32px', padding: '20px', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <Heading as="h3" style={{ margin: '0 0 16px 0', fontSize: '16px', color: '#0F172A' }}>
                Datos para el Pago
              </Heading>
              
              <div style={{ marginBottom: '16px' }}>
                <Text style={{ margin: '0 0 4px 0', fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase', color: '#475569' }}>
                  Transferencia Bancaria (ARS)
                </Text>
                <ul style={{ margin: '0 0 0 0', paddingLeft: '0', listStyle: 'none', fontSize: '14px', color: '#334155' }}>
                  <li style={{ marginBottom: '4px' }}><strong>Banco:</strong> {siteConfig.payment.bankName}</li>
                  <li style={{ marginBottom: '4px' }}><strong>Titular:</strong> {siteConfig.payment.bankOwner}</li>
                  <li style={{ marginBottom: '4px' }}><strong>Alias:</strong> {siteConfig.payment.bankAliasArs}</li>
                  <li style={{ marginBottom: '4px' }}><strong>CVU:</strong> {siteConfig.payment.bankCbuArs}</li>
                </ul>
              </div>

              <div>
                <Text style={{ margin: '0 0 4px 0', fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase', color: '#475569' }}>
                  Crypto (BNB BEP20)
                </Text>
                <Text style={{ margin: '0', fontSize: '11px', fontFamily: 'monospace', background: '#fff', padding: '8px', border: '1px solid #cbd5e1', borderRadius: '4px', wordBreak: 'break-all' }}>
                  0x76d1f11aad0c31bf5563f646e6e4a4ba1564ebcf
                </Text>
              </div>

              <Section style={{ marginTop: '20px', padding: '12px', backgroundColor: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '4px' }}>
                <Text style={{ margin: 0, fontSize: '12px', color: '#b45309', textAlign: 'center' }}>
                  ⚠️ <strong>Importante:</strong> La cotización del dólar está visible en la parte superior de nuestra web.
                </Text>
              </Section>
            </Section>
          )}

        </Container>
      </Body>
    </Html>
  )
}

export default OrderTemplate;
