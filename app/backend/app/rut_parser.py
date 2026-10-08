"""Parser del RUT (Formulario 001 de la DIAN) en PDF de texto.

MUISCA genera PDFs con texto seleccionable. El parser es heurístico y se ancla
en etiquetas/posiciones estables. NUNCA aplica cambios: solo devuelve lo leído
para que el usuario concilie contra la ficha.

Soporta: NIT/DV (5,6), tipo contribuyente (24), razón social (35),
apellidos/nombres (31-34, persona natural), sigla (37), depto/municipio DANE
(39,40), dirección (41), correo (42), teléfonos (44,45), CIIU principal/
secundaria (46,48), responsabilidades (53) y representante legal principal.
"""
from __future__ import annotations

import re
import unicodedata
from collections import Counter
from io import BytesIO

from pypdf import PdfReader

# Direcciones seccionales DIAN (Res. 000065/2021). Nombre como aparece en el RUT
# (casilla 12), sin el prefijo "Dirección Seccional de …".
_SECCIONALES = {
    "00": "Nivel Central", "01": "Impuestos y Aduanas de Armenia",
    "02": "Impuestos de Barranquilla", "03": "Aduanas de Bogotá Aeropuerto El Dorado",
    "04": "Impuestos y Aduanas de Bucaramanga", "05": "Impuestos de Cali",
    "06": "Impuestos de Cartagena", "07": "Impuestos de Cúcuta",
    "08": "Impuestos y Aduanas de Girardot", "09": "Impuestos y Aduanas de Ibagué",
    "10": "Impuestos y Aduanas de Manizales", "11": "Impuestos de Medellín",
    "12": "Impuestos y Aduanas de Montería", "13": "Impuestos y Aduanas de Neiva",
    "14": "Impuestos y Aduanas de Pasto", "15": "Impuestos y Aduanas de Palmira",
    "16": "Impuestos y Aduanas de Pereira", "17": "Impuestos y Aduanas de Popayán",
    "18": "Impuestos y Aduanas de Quibdó", "19": "Impuestos y Aduanas de Santa Marta",
    "20": "Impuestos y Aduanas de Tunja", "21": "Impuestos y Aduanas de Tuluá",
    "22": "Impuestos y Aduanas de Villavicencio", "23": "Impuestos y Aduanas de Sincelejo",
    "24": "Impuestos y Aduanas de Valledupar", "25": "Impuestos y Aduanas de Riohacha",
    "26": "Impuestos y Aduanas de Sogamoso", "27": "Impuestos y Aduanas de San Andrés",
    "28": "Impuestos y Aduanas de Florencia", "29": "Impuestos y Aduanas de Barrancabermeja",
    "31": "Grandes Contribuyentes", "32": "Impuestos de Bogotá",
    "34": "Impuestos y Aduanas de Arauca", "35": "Impuestos y Aduanas de Buenaventura",
    "37": "Impuestos y Aduanas de Ipiales", "38": "Impuestos y Aduanas de Leticia",
    "39": "Impuestos y Aduanas de Maicao", "40": "Impuestos y Aduanas de Tumaco",
    "41": "Impuestos y Aduanas de Urabá", "42": "Impuestos y Aduanas de Puerto Carreño",
    "43": "Impuestos y Aduanas de Puerto Inírida", "44": "Impuestos y Aduanas de Yopal",
    "45": "Impuestos y Aduanas de Mitú", "46": "Impuestos y Aduanas de Puerto Asís",
    "48": "Aduanas de Cartagena", "78": "Impuestos y Aduanas de San José de Guaviare",
    "86": "Impuestos y Aduanas de Pamplona", "87": "Aduanas de Barranquilla",
    "88": "Aduanas de Cali", "89": "Aduanas de Cúcuta", "90": "Aduanas de Medellín",
    "91": "Aduanas de Bogotá",
}


def _norm_sec(s: str) -> str:
    s = unicodedata.normalize("NFD", (s or "").lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", s)).strip()


_SEC_LOOKUP = {_norm_sec(v): k for k, v in _SECCIONALES.items()}

_STREET = r"(?:BRR|CR|KR|CRA|CLL|CL|CALLE|CARRERA|AV|AVDA|AC|AK|DG|TV|MZ|VIA|VDA|KM)"

# Tipo de documento (casilla 25): frase en el RUT -> código del catálogo.
_DOCMAP = [
    ("registro civil", "RC"), ("tarjeta de identidad", "TI"),
    ("cédula de ciudadan", "CC"), ("cedula de ciudadan", "CC"),
    ("tarjeta de extranj", "TE"), ("cédula de extranj", "CE"), ("cedula de extranj", "CE"),
    ("pasaporte", "PA"), ("documento de identificación extranjero", "DE"),
    ("nit de otro país", "NP"), ("permiso especial", "PEP"), ("nit", "NT"),
]

# Partículas que se unen al apellido/nombre siguiente al separar (casillas 31-34).
_PARTICULAS = {"DE", "DEL", "LA", "LAS", "LOS", "VAN", "VON", "DA", "DI", "SAN", "SANTA", "MC", "MAC"}


def _split_nombre(linea: str) -> tuple[str, str, str, str]:
    """'CARDONA VELEZ RENZO' -> (primer_apellido, segundo_apellido, primer_nombre, otros)."""
    toks = linea.split()
    grupos: list[str] = []
    i = 0
    while i < len(toks):
        if toks[i].upper() in _PARTICULAS and i + 1 < len(toks):
            grupos.append(toks[i] + " " + toks[i + 1]); i += 2
        else:
            grupos.append(toks[i]); i += 1
    pa = grupos[0] if grupos else ""
    if len(grupos) > 2:
        sa = grupos[1]; resto = grupos[2:]
    else:
        sa = ""; resto = grupos[1:]
    n1 = resto[0] if resto else ""
    otros = " ".join(resto[1:]) if len(resto) > 1 else ""
    return pa, sa, n1, otros


def _digs(s: str) -> str:
    return re.sub(r"\D", "", s or "")


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip())


def _fecha_iso(digitos: str) -> str:
    """'AAAAMMDD' -> 'AAAA-MM-DD' si es una fecha válida; '' si no."""
    if re.fullmatch(r"(19|20)\d{2}(0[1-9]|1[0-2])([0-2]\d|3[01])", digitos or ""):
        return f"{digitos[:4]}-{digitos[4:6]}-{digitos[6:8]}"
    return ""


def leer_texto(data: bytes) -> list[str]:
    return [(p.extract_text() or "") for p in PdfReader(BytesIO(data)).pages]


def parse_rut(data: bytes) -> dict:
    pgs = leer_texto(data)
    if not pgs:
        return {}
    p1 = pgs[0]
    full = "\n".join(pgs)
    lineas = [l.strip() for l in p1.splitlines() if l.strip()]
    r: dict = {}

    # --- NIT + DV: el run de dígitos del encabezado (dígitos seguidos del nombre de
    # la seccional), tomado como el más frecuente entre páginas.
    cont: Counter = Counter()
    for pg in pgs:
        for m in re.finditer(r"(?m)^\s*([\d ]{9,25}?)\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]", pg):
            d = _digs(m.group(1))
            if 8 <= len(d) <= 11:
                cont[d] += 1
    if cont:
        nit = cont.most_common(1)[0][0]
        r["num_id"] = nit[:-1]
        r["dv"] = nit[-1]

    # --- Tipo de contribuyente (24) ---
    es_nat = bool(re.search(r"Persona\s+natural", p1, re.I))
    if re.search(r"Persona\s+jur[íi]dica", p1, re.I):
        r["tipo_contribuyente"] = "Jur"
    elif es_nat:
        r["tipo_contribuyente"] = "Nat"

    # --- Dirección seccional (casilla 12): la línea "…NIT… <nombre seccional> <n>";
    # se toma el nombre tras el NIT y se mapea al código oficial.
    for l in lineas:
        m = re.match(r"^\s*(?:\d\s*){8,}([A-Za-zÁÉÍÓÚÑáéíóúñ].*)$", l)
        if not m:
            continue
        resto = m.group(1)
        # El código seccional va al FINAL de la línea, sin cero a la izquierda y con
        # espacios entre dígitos: "Impuestos de Bogotá 3 2" = 32; "…Cartagena 6" = 06.
        # (Antes solo se quitaba un grupo de dígitos, así que los códigos de 2 dígitos
        #  dejaban basura en el nombre y no mapeaban → solo servían los de 1 dígito.)
        nombre = re.sub(r"[\s\d]+$", "", resto).strip()
        cod = _SEC_LOOKUP.get(_norm_sec(nombre))
        if not cod:                                   # respaldo: los dígitos finales = el código
            mt = re.search(r"((?:\d\s*){1,2})\s*$", resto)
            if mt:
                d = _digs(mt.group(1)).zfill(2)
                if d in _SECCIONALES:
                    cod = d
        if cod:
            r["seccional_codigo"] = cod
            break

    # --- Tipo de documento (25) y nombres (31-34), solo persona natural ---
    if es_nat:
        low = p1.lower()
        for frase, cod in _DOCMAP:
            if frase in low:
                r["tipo_documento"] = cod
                break
        # Nombre: línea en MAYÚSCULAS entre las dos líneas "COLOMBIA ..." (lugar de
        # expedición 28-30 y ubicación 38-40).
        idx_col = [i for i, l in enumerate(lineas) if re.match(r"COLOMBIA\b", l) and _digs(l)]
        if idx_col:
            j = idx_col[0] + 1
            if j < len(lineas) and re.fullmatch(r"[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ ]+", lineas[j]):
                pa, sa, n1, otros = _split_nombre(lineas[j])
                r["primer_apellido"] = pa
                r["segundo_apellido"] = sa
                r["primer_nombre"] = n1
                r["otros_nombres"] = otros
                r["nombre"] = _norm(" ".join(x for x in [pa, sa, n1, otros] if x))

    # --- Razón social (35) / sigla (37) ---
    # La DIAN suele separar con espacios las letras del sufijo: "MEDIINSUMOS S A S".
    # Se unen las secuencias de letras sueltas ("S A S" -> "SAS") antes de detectar,
    # y se ignoran las líneas con "@" (el correo "…mediinsumossas@…" contiene "sas"
    # y antes se tomaba como razón social).
    def _juntar_sueltas(s: str) -> str:
        return re.sub(r"(?:\b[A-Za-zÁÉÍÓÚÑ]\b ?){2,}",
                      lambda m: m.group(0).replace(" ", ""), s).strip()
    # Sufijos societarios como PALABRA completa (evita falsos positivos con
    # "vigenCIA/consecuenCIA" del texto legal) + prefijos de formas asociativas.
    _SUFIJO = re.compile(
        r"\b(?:SAS|SASBIC|LTDA|SA|SCA|SCS|EU|CIA|SENC|BIC)\b"
        r"|\bS\.? ?EN ?C\b"
        r"|\b(?:FUNDACI|CORPORACI|ASOCIA|COOPERATIV)", re.I)
    idx_rs = None
    for i, l in enumerate(lineas):
        if "@" in l or re.match(r"\d", l):
            continue
        l_join = _juntar_sueltas(l)                    # valor a mostrar (conserva puntos: "S.A.S")
        l_det = _juntar_sueltas(l.replace(".", ""))    # solo para detectar (une "S A S"/"S.A.S" -> "SAS")
        if _SUFIJO.search(l_det) and len(re.sub(r"\s", "", l_det)) > 5:
            idx_rs = i
            r["razon_social"] = _norm(l_join)
            break
    if idx_rs is not None and idx_rs + 1 < len(lineas):
        sig = lineas[idx_rs + 1]
        if 2 <= len(sig) <= 40 and not re.search(r"COLOMBIA|@|\d{3}", sig):
            r["sigla"] = _norm(sig)

    # --- Depto/Municipio DANE (39,40): "COLOMBIA 169 Bolívar 13 Cartagena 001".
    # En natural hay dos líneas COLOMBIA (lugar de expedición y ubicación); la
    # ubicación (casilla 40) es la última.
    cols = [l for l in lineas if re.search(r"COLOMBIA", l) and _digs(l)]
    linea_ubi = cols[-1] if cols else ""
    if linea_ubi:
        d = _digs(re.sub(r"(?<=\d)\s+(?=\d)", "", linea_ubi))
        # país(3) + depto(2) + municipio(3) => total 8 dígitos al unir
        m = re.search(r"(\d{3})(\d{2})(\d{3})\b", d)
        if m:
            r["departamento_dane"] = m.group(2)
            r["municipio_dane"] = m.group(2) + m.group(3)

    # --- Correo (42) ---
    m = re.search(r"[\w.+-]+@[\w-]+\.[\w.-]+", p1)
    if m:
        r["email"] = m.group(0).strip()
        # --- Dirección (41): línea anterior al correo ---
        idx_mail = next((i for i, l in enumerate(lineas) if r["email"] in l), None)
        if idx_mail is not None:
            for j in range(idx_mail - 1, -1, -1):
                if re.search(_STREET + r"\b", lineas[j], re.I) or re.search(_STREET + r"\s", lineas[j], re.I):
                    r["direccion"] = _norm(lineas[j])
                    break
        # --- Teléfonos (44,45): línea siguiente al correo, separada por columnas ---
        if idx_mail is not None and idx_mail + 1 < len(lineas):
            tl = lineas[idx_mail + 1]
            grupos = [g for g in re.split(r"\s{2,}", tl) if _digs(g)]
            tels = [_digs(re.sub(r"(?<=\d)\s+(?=\d)", "", g)) for g in grupos]
            tels = [t for t in tels if 7 <= len(t) <= 11]
            if tels:
                r["telefono"] = tels[0]

    # --- CIIU principal/secundaria (46,48): línea sólo de dígitos → slice posicional.
    # La línea de CIIU trae fecha de inicio (AAAAMMDD) tras el código: d[4:8] es un
    # año válido (evita confundir con la fila de encabezado "1 2 3 4 ...").
    def _anio_ok(a: str) -> bool:
        return len(a) == 4 and 1900 <= int(a) <= 2099
    for l in lineas:
        if re.fullmatch(r"[\d ]+", l):
            d = _digs(l)
            if len(d) >= 12 and _anio_ok(d[4:8]) and 1 <= int(d[8:10] or 99) <= 12:
                r["actividad_ciiu_principal"] = d[:4]           # casilla 46
                if len(d) >= 16 and re.fullmatch(r"\d{4}", d[12:16]):
                    r["actividad_ciiu_secundaria"] = d[12:16]   # casilla 48
                break

    # --- Responsabilidades (53): prefijos "NN- descripción" ---
    resp: list[str] = []
    for c in re.findall(r"(?m)^\s*(\d{2})\s*-\s*[A-Za-zÁÉÍÓÚÑ]", full):
        if c not in resp:
            resp.append(c)
    if resp:
        r["responsabilidades"] = resp

    # --- Representante legal principal (hoja "Representación") ---
    hoja = next((pg for pg in pgs if "REPRS LEGAL" in pg.upper()), "")
    if hoja:
        rl: dict = {}
        if re.search(r"C[ée]dula de Ciudadan", hoja):
            rl["tipo_documento"] = "CC"
        elif re.search(r"C[ée]dula de Extranj", hoja):
            rl["tipo_documento"] = "CE"
        # Cédula del RL: línea de dígitos espaciados (8-11), que no sea una fecha
        # (AAAAMMDD) ni el NIT del contribuyente.
        nit_full = r.get("num_id", "") + (r.get("dv", "") or "")
        def _es_fecha(x: str) -> bool:
            return bool(re.fullmatch(r"(19|20)\d{2}(0[1-9]|1[0-2])([0-2]\d|3[01])", x))
        for l in hoja.splitlines():
            ls = l.strip()
            if re.fullmatch(r"[\d ]+", ls):
                d = _digs(ls)
                if 7 <= len(d) <= 11 and not _es_fecha(d) and d != nit_full and not d.startswith("14119"):
                    rl["num_id"] = d
                    break
        may = [l.strip() for l in hoja.splitlines()
               if re.fullmatch(r"[A-ZÁÉÍÓÚÑ]{2,}(?: [A-ZÁÉÍÓÚÑ]+)*", l.strip())
               and l.strip() not in ("REPRS LEGAL PRIN", "REPRS LEGAL SUPL", "COLOMBIA")]
        if may:
            # Con 1 solo RL (solo PRIN) los 4 componentes van consecutivos; con 2
            # (PRIN + SUPL) van intercalados (principal en las posiciones pares).
            n_rl = len([l for l in hoja.splitlines()
                        if re.search(r"REPRS LEGAL (PRIN|SUPL)", l.upper())]) or 1
            partes = [may[i * n_rl] for i in range(4) if i * n_rl < len(may)]
            nombre = _norm(" ".join(partes))
            if nombre:
                rl["nombre"] = nombre
        # Fecha inicio ejercicio (casilla 99): primera AAAAMMDD tras "REPRS LEGAL PRIN".
        lns = hoja.splitlines()
        ix = next((i for i, l in enumerate(lns) if "REPRS LEGAL PRIN" in l.upper()), -1)
        if ix >= 0:
            for l in lns[ix:]:
                f = _fecha_iso(_digs(l))
                if f:
                    rl["desde"] = f
                    break
        # Código de representación (casilla 98): "REPRS LEGAL PRIN 1 8" -> "18".
        mcod = re.search(r"REPRS LEGAL PRIN\s+(\d)\s*(\d)", hoja.upper())
        if mcod:
            rl["codigo"] = mcod.group(1) + mcod.group(2)
        if rl:
            r["representante"] = rl

    # --- Contador y Revisor fiscal (hoja "Revisor Fiscal y Contador") ---
    # El rol se decide por la POSICIÓN del bloque en la hoja de datos: los tres
    # cupos van a ~8 líneas de distancia → 0=revisor ppal, 1=contador, 2=suplente.
    rc = next((pg for pg in pgs if "REVISOR" in pg.upper() and "CONTADOR" in pg.upper()), "")
    if rc:
        data = rc.split("Hoja 5")[-1] if "Hoja 5" in rc else rc
        lines = [l.rstrip() for l in data.splitlines()]
        base = next((i for i, l in enumerate(lines)
                     if re.fullmatch(r"\s*\d\s+\d\s*", l)), 5) + 1   # línea "N M" (nº de página)
        i = 0
        while i < len(lines):
            l = lines[i]
            mt = re.search(r"\s{3,}([\d ]+?)\s*T?\s*$", l)   # tarjeta tras gran espacio ("T" opcional)
            if mt and re.search(r"documento|c[ée]dula", l, re.I):
                tarjeta = _digs(mt.group(1)) + "T"
                nombre = ""
                j = i + 1
                while j < len(lines) and j < i + 6:
                    if re.fullmatch(r"[A-ZÁÉÍÓÚÑ ]{4,}", lines[j].strip()):
                        nombre = _norm(lines[j].strip())
                        break
                    j += 1
                fecha = ""
                k = j + 1
                while k < len(lines) and k < j + 6:
                    fecha = _fecha_iso(_digs(lines[k]))
                    if fecha:
                        break
                    k += 1
                slot = round((i - base) / 8)
                key = "contador" if slot == 1 else "revisor"   # 0 y 2 → revisor (ppal/suplente)
                if (nombre or len(tarjeta) > 1) and key not in r:  # conserva el primero (principal)
                    r[key] = {"nombre": nombre, "tarjeta": tarjeta, "desde": fecha}
                i = max(k, i + 1)
            else:
                i += 1

    return r
