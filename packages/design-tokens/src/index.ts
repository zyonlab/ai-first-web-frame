export const tokens = {
  color: {
    ink: "#15171a",
    paper: "#fbfaf7",
    accent: "#0f766e",
    signal: "#d97706",
    muted: "#69707a",
  },
  spacing: { xs: "4px", sm: "8px", md: "16px", lg: "24px", xl: "40px" },
  radius: { sm: "4px", md: "8px", lg: "12px" },
  font: {
    body: "ui-serif, Georgia, serif",
    control: "ui-sans-serif, system-ui, sans-serif",
  },
  zIndex: { base: 0, overlay: 20, modal: 50 },
  breakpoint: { sm: "640px", md: "768px", lg: "1024px" },
  shadow: { raised: "0 12px 30px rgba(21, 23, 26, 0.14)" },
} as const;

export function createCssVariables(prefix = "mvp") {
  const lines: string[] = [];
  for (const [group, values] of Object.entries(tokens)) {
    for (const [key, value] of Object.entries(values)) {
      lines.push(`--${prefix}-${group}-${key}: ${value};`);
    }
  }
  return `:where(:root){${lines.join("")}}`;
}
