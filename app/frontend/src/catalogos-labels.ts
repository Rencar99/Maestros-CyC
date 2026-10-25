// Etiquetas y listas del catálogo de Obligaciones (criterio, disparador, familia…).
// Fuente ÚNICA: la usan Catálogos (editor) y Clientes (ficha → obligaciones).
export const CRITERIOS = ["nit1", "nit2", "fijo"];
export const CRIT_TXT: Record<string, string> = { nit1: "Último dígito", nit2: "2 últimos dígitos", fijo: "Fecha única", grupo: "Por grupo", municipio: "Por municipio" };
export const PERIODICIDADES = ["", "Mensual", "Bimestral", "Cuatrimestral", "Semestral", "Anual"];
export const DISPARADORES = ["", "renta_jur", "renta_nat", "renta_gc", "retencion", "inc", "iva_bim", "iva_cuat", "iva_anual", "rst_anual", "rst_anticipo", "exogena_jn", "exogena_gc", "beneficiarios"];
export const DISP_TXT: Record<string, string> = { "": "— (manual)", renta_jur: "Renta P. Jurídica", renta_nat: "Renta P. Natural", renta_gc: "Renta Grandes Contrib.", retencion: "Retención (07)", reteiva: "ReteIVA (07)", inc: "INC (33)", iva_bim: "IVA Bimestral (48)", iva_cuat: "IVA Cuatrimestral (48)", iva_anual: "IVA Anual RST (47+48)", rst_anual: "RST Declaración (47)", rst_anticipo: "RST Anticipo (47)", exogena_jn: "Exógena Jur/Nat (14)", exogena_gc: "Exógena Grandes Contrib. (14)", beneficiarios: "Beneficiarios Finales (RUB)" };
export const FAMILIAS: [string, string][] = [["dian", "Impuestos DIAN"], ["super", "Superintendencias"], ["municipal", "Impuestos municipales"], ["nomina", "Obligaciones de nómina"], ["otras", "Otras obligaciones"]];
