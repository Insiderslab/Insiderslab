"""Operazioni sulle mappe media che NON richiedono l'AI (zero crediti).

1. Sposta nelle mappe di Terre di Trincea e Alle Trincee le righe di Medea
   taggate "vigna - NON per Medea" / "agriturismo - NON per Medea".
2. Compila "Già pubblicata?" confrontando i file mappati con quelli nelle
   cartelle social (03 Social Media, Post <mese>...): prima per dimensione,
   poi per hash SHA-256. Solo corrispondenze esatte, niente supposizioni.

Uso (Windows, dal Prompt dei comandi):
    python mappe_utils.py
Legge e scrive solo nella cartella MAPPE. Le cartelle clienti sono in sola
lettura. Prima di modificare un CSV ne salva una copia .bak.
"""
import csv
import hashlib
import os
import shutil
import sys
from collections import defaultdict
from datetime import datetime

ROOT = r"G:\.shortcut-targets-by-id\1x09gZUobVR-b75FguCEbkVEr8t7pNVns\Clientes Clients"
MAPPE = r"C:\Users\stefa\OneDrive\Documenti\ChatGPT\Social Media Manager\mappe"

# nome nel CSV -> parole per riconoscere la cartella del cliente
CLIENTI = {
    "Ortofrutticola_Medea": ["medea"],
    "Terre_di_Trincea": ["terre di trincea"],
    "Agriturismo_Alle_Trincee": ["alle trincee"],
    "Lumii": ["lumii"],
    "Studio_Fabbro": ["fabbro"],
    "Ecosmart_Building_Italia": ["ecosmart"],
    "Paried": ["paried"],
    "Hair_Extension_Clinic": ["hair extension"],
    "Soshi_Hair": ["soshi"],
    "Insiders_Lab": ["insiders lab", "insiderslab"],
}
# i marchi del gruppo Medea usano anche il materiale nella cartella di Medea
CARTELLE_EXTRA = {
    "Terre_di_Trincea": ["Ortofrutticola_Medea"],
    "Agriturismo_Alle_Trincee": ["Ortofrutticola_Medea"],
}
SOCIAL = ("03 social media", "social media", "post ")
MEDIA = {".jpg", ".jpeg", ".png", ".heic", ".webp", ".mp4", ".mov", ".m4v", ".gif"}
SALTA = ("invoice", "factura", "fattur", "preventiv", "presupuest")

COL_NOME, COL_LINK, COL_PUBB, COL_TAG = 0, 1, 11, 13


def log(msg):
    print(f"[{datetime.now():%H:%M:%S}] {msg}", flush=True)


def leggi_csv(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        righe = list(csv.reader(f, delimiter=";"))
    return righe[0], righe[1:]


def scrivi_csv(path, testata, righe):
    if os.path.exists(path):
        shutil.copy2(path, path + ".bak")
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(testata)
        w.writerows(righe)


def csv_cliente(nome):
    return os.path.join(MAPPE, f"MAPPA_MEDIA_{nome}.csv")


def cartella_cliente(nome):
    chiavi = CLIENTI[nome]
    trovate = [d for d in os.listdir(ROOT)
               if os.path.isdir(os.path.join(ROOT, d))
               and any(k in d.lower() for k in chiavi)]
    if len(trovate) != 1:
        log(f"  {nome}: cartella non univoca {trovate} -> saltato")
        return None
    return os.path.join(ROOT, trovate[0])


# ---------------------------------------------------------------- compito 1
def sposta_marchi_gruppo():
    medea_path = csv_cliente("Ortofrutticola_Medea")
    testata, medea = leggi_csv(medea_path)
    destinazioni = {
        "vigna - NON per Medea": ("Terre_di_Trincea", "assegnato a Terre di Trincea"),
        "agriturismo - NON per Medea": ("Agriturismo_Alle_Trincee", "assegnato ad Alle Trincee"),
    }
    for tag, (dest, etichetta) in destinazioni.items():
        dest_path = csv_cliente(dest)
        _, esistenti = leggi_csv(dest_path) if os.path.exists(dest_path) else (testata, [])
        chiavi = {(r[COL_NOME], r[COL_LINK]) for r in esistenti}
        nuove = 0
        for r in medea:
            if tag in r[COL_TAG]:
                if (r[COL_NOME], r[COL_LINK]) not in chiavi:
                    esistenti.append(list(r))
                    chiavi.add((r[COL_NOME], r[COL_LINK]))
                    nuove += 1
                if etichetta not in r[COL_TAG]:
                    r[COL_TAG] = f"{r[COL_TAG]}, {etichetta}"
        scrivi_csv(dest_path, testata, esistenti)
        log(f"  {dest}: +{nuove} righe da Medea (totale {len(esistenti)})")
    scrivi_csv(medea_path, testata, medea)


# ---------------------------------------------------------------- compito 2
def indicizza(cartella):
    """Restituisce (materiale: nome->[path], social: size->[path])."""
    materiale, social = defaultdict(list), defaultdict(list)
    for dirpath, _, files in os.walk(cartella):
        basso = dirpath.lower()
        if any(s in basso for s in SALTA):
            continue
        is_social = any(s in os.path.relpath(dirpath, cartella).lower() for s in SOCIAL)
        for fn in files:
            if os.path.splitext(fn)[1].lower() not in MEDIA:
                continue
            p = os.path.join(dirpath, fn)
            if is_social:
                try:
                    social[os.path.getsize(p)].append(p)
                except OSError:
                    pass
            else:
                materiale[fn].append(p)
    return materiale, social


def sha256(path, cache):
    if path not in cache:
        h = hashlib.sha256()
        with open(path, "rb") as f:
            for blocco in iter(lambda: f.read(1 << 20), b""):
                h.update(blocco)
        cache[path] = h.hexdigest()
    return cache[path]


def controlla_pubblicati(nome, cache):
    path_csv = csv_cliente(nome)
    if not os.path.exists(path_csv):
        return
    cartelle = [cartella_cliente(n) for n in [nome] + CARTELLE_EXTRA.get(nome, [])]
    cartelle = [c for c in cartelle if c]
    if not cartelle:
        return
    materiale, social = defaultdict(list), defaultdict(list)
    for c in cartelle:
        m, s = indicizza(c)
        for k, v in m.items():
            materiale[k] += v
        for k, v in s.items():
            social[k] += v
    log(f"  {nome}: {sum(map(len, social.values()))} file nelle cartelle social")

    testata, righe = leggi_csv(path_csv)
    si = nontrovati = 0
    for r in righe:
        if not r[COL_PUBB].strip().lower().startswith("non so"):
            continue
        link = r[COL_LINK]
        candidati = [link] if os.path.isfile(link) else materiale.get(r[COL_NOME], [])
        if len(candidati) != 1:
            nontrovati += 1
            continue
        src = candidati[0]
        try:
            stessi = social.get(os.path.getsize(src), [])
            if not stessi:
                continue
            h = sha256(src, cache)
            for p in stessi:
                if sha256(p, cache) == h:
                    rel = os.path.relpath(os.path.dirname(p), ROOT)
                    r[COL_PUBB] = f"sì (copia identica in {rel})"
                    si += 1
                    break
        except OSError as e:
            log(f"    errore su {r[COL_NOME]}: {e}")
    scrivi_csv(path_csv, testata, righe)
    log(f"  {nome}: {si} segnati 'sì', {nontrovati} file non localizzati univocamente")
    return si


def main():
    if not os.path.isdir(ROOT) or not os.path.isdir(MAPPE):
        sys.exit("Controlla i percorsi ROOT e MAPPE in cima al file.")
    log("1) Righe di Medea verso Terre di Trincea e Alle Trincee")
    sposta_marchi_gruppo()
    log("2) Controllo 'già pubblicata?' per copia identica")
    cache = {}
    for nome in CLIENTI:
        controlla_pubblicati(nome, cache)
    log("Fatto. Le copie precedenti dei CSV sono salvate come .bak")


if __name__ == "__main__":
    main()
