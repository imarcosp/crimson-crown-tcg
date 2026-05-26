export const siteConfig = {
  name: "Crimson Crown TCG",
  shortName: "Crimson Crown",
  description: "Tu tienda especializada en Magic: The Gathering.",
  url: "https://www.elpercherotcg.com",
  logo: "/logo.webp?v=crimson1",
  socialImage: "/opengraph-image.png",
  socialLinks: {
    instagram: "https://www.instagram.com/elpercherotcg/",
    whatsapp: "5491134739690",
    email: "crimsoncrownimports@gmail.com",
  },
  payment: {
    bankOwner: "Facundo Ezequiel Lira Rodríguez",
    bankName: "Mercado Pago",
    bankAliasArs: "coronamtg",
    bankCbuArs: "0000003100018685270995"
  },
  theme: {
    primary: "#1C1B22",      // fondo principal oscuro
    accent: "#9D1B1B",       // crimson
    accentHover: "#7E1515",  // crimson oscuro
    gold: "#C7A316",         // detalles dorados
  },
  features: {
    showRiftbound: false,
    showSecretLair: false,
    showAccessories: false,
    showSealed: false,
  },
};

export type SiteConfig = typeof siteConfig;
