// src/utils/cn.ts
type ClassPrimitive = string | number | null | undefined | false;
type ClassDict = Record<string, boolean>;
type ClassValue = ClassPrimitive | ClassDict | ClassValue[];

/**
 * Junta classes de forma segura:
 * - Ignora falsy (null/undefined/false/"")
 * - Aceita objetos { "classe": condicao }
 * - Aceita arrays aninhados
 */
export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];

  const push = (val: ClassValue) => {
    if (!val) return;
    if (typeof val === "string" || typeof val === "number") {
      if (String(val).trim().length) out.push(String(val).trim());
      return;
    }
    if (Array.isArray(val)) {
      val.forEach(push);
      return;
    }
    if (typeof val === "object") {
      for (const k in val as ClassDict) {
        if ((val as ClassDict)[k]) out.push(k);
      }
    }
  };

  inputs.forEach(push);
  return out.join(" ");
}

export default cn;
