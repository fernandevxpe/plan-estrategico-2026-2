/**
 * Paleta de gráficos alinhada à marca XPE / USE.
 * Referência: xpeconsultoria.com — roxo #bc13fe, verde neon #39ff14.
 * Verde operacional mantém contraste legível em fundo claro.
 */
export const chartTheme = {
  purple: "#bc13fe",
  purpleDeep: "#9b2fd4",
  purpleSoft: "#d8b4fe",
  purpleMuted: "#c084fc",
  green: "#21a67a",
  greenBrand: "#39ff14",
  amber: "#b67818",
  teal: "#0f766e",
  slate: "#9fb2bd",
  ink: "#17333a"
} as const;

export const mixColors = [
  chartTheme.green,
  chartTheme.purple,
  chartTheme.amber,
  chartTheme.teal,
  chartTheme.purpleDeep,
  "#c8553d",
  "#5b8c5a",
  "#7a6a3a",
  chartTheme.purpleMuted,
  "#9b5de5",
  "#c47f2c",
  "#4b5563"
];
