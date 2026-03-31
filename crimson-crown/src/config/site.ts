export const siteConfig = {
  name: "El Perchero TCG",
  shortName: "El Perchero",
  description: "Tu tienda especializada en Magic: The Gathering. Stock local, pedidos internacionales y la mejor cotización del mercado.",
  url: "https://www.elpercherotcg.com",
  socialLinks: {
    instagram: "https://www.instagram.com/elpercherotcg/",
    whatsapp: "5491130951844",
    email: "elpercherollc@gmail.com",
  },
  payment: {
    bankAliasArs: "elpercherotcg",
    bankAliasUsd: "Marcos.Perche.usd"
  },
  theme: {
    primary: "#0F172A",
    accent: "#E91E63",
    accentHover: "#D81B60",
  },
};

export type SiteConfig = typeof siteConfig;
