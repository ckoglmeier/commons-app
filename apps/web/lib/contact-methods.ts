export function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (value.trim().startsWith("+")) return digits.length >= 8 && digits.length <= 15 && !digits.startsWith("0") ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export function contactUpdateError(kind: "phone" | "email", error: { code?: string; message?: string }) {
  const detail = `${error.code ?? ""} ${error.message ?? ""}`.toLowerCase();
  const label = kind === "phone" ? "mobile number" : "email";
  if (detail.includes("already") || detail.includes("exists") || detail.includes("registered")) {
    return `That ${label} is already connected to another Commons account.`;
  }
  return `${kind === "phone" ? "Mobile number" : "Email"} not updated. Try again.`;
}
