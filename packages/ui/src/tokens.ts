export const commonsTokens = {
  color: {
    ink: "#16372F",
    green: "#2E6758",
    mineral: "#5E6C67",
    canvas: "#FFFFFF",
    sand: "#FFFFFF",
    paper: "#FFFFFF",
    line: "#DCE4E0",
    coral: "#E8A099",
    coralWash: "#FAECE9",
    ember: "#A64132",
    greenWash: "#E4ECE8",
    emberWash: "#F4E4DF",
    onInkSecondary: "#B8D5C8",
  },
  radius: {
    compact: 10,
    control: 16,
    focal: 24,
    sheet: 28,
  },
  motion: {
    fast: 160,
    standard: 220,
    sheet: 420,
  },
  touchTarget: 44,
} as const;

export type CommonsTokens = typeof commonsTokens;
