"""
SUPPRIMER LE FOND D'UNE IMAGE, SUR LE POSTE, SANS RIEN DÉPENSER
================================================================

Le studio sait déjà supprimer un fond en appelant Higgsfield, ce qui coûte un
crédit. Ce script fait la même chose en local, gratuitement et hors ligne.

    python detourer.py <image d'entrée> <image de sortie .png> [ia|uni|auto]

Trois méthodes :
  ia    le modèle BiRefNet-general (licence MIT) : il trouve « le sujet » d'une
        photo. C'est la méthode d'avant, et celle par défaut.
  uni   sans IA, pour un objet posé sur un fond UNI (le blanc des objets de carte) :
        la couleur du fond est lue sur les bords, et tout ce qui a cette couleur ET
        touche les bords part. Ce qui est entouré par l'objet reste, même blanc.
        Ajouté le 26 sept. 2026 : sur un smartphone dont l'écran montrait une
        cuisinière, BiRefNet a gardé la cuisinière et coupé le téléphone — pour lui,
        le « sujet », c'était elle.
  auto  « uni » si les bords de l'image sont d'une seule couleur, sinon « ia ».

Il écrit une ligne de JSON sur la sortie standard, que serveur.js relit :
    {"ok": true, "secondes": 11.4, "largeur": 1125, "hauteur": 2000, "methode": "uni"}
    {"ok": false, "erreur": "..."}

SEULEMENT numpy, Pillow et onnxruntime (5 oct. 2026). Avant, le modèle passait par
rembg, qui charge au démarrage pymatting → numba, et scipy : sur un Windows 11 où
« Smart App Control » est actif, Windows BLOQUE ces fichiers (trop récents, pas
signés) et le détourage ne marchait plus du tout (vu sur un poste). onnxruntime est
signé par Microsoft ; numpy et Pillow passent. Le calcul est celui de rembg pour
BiRefNet, à l'identique : image en 1024 × 1024, normalisation ImageNet, sigmoïde,
étirement min-max, masque agrandi en Lanczos, découpe « naïve ». N'ajoutez pas
d'autre paquet compilé ici sans l'essayer sous Smart App Control.

LE MODÈLE EST NOMMÉ EXPRÈS : BiRefNet-general, publié sous licence MIT par ses
auteurs (le modèle par défaut de rembg, bria-rmbg, est NON COMMERCIAL). Ce
fichier ne contient aucun modèle : il lit celui que la page Installation a
téléchargé dans le dossier de la personne (là où rembg le rangeait, pour que les
postes déjà installés le retrouvent). Sans modèle, le studio retombe sur le
bouton Higgsfield.
"""

import json
import os
import sys
import time

SEUIL = 30.0          # écart de couleur (sur 441) en dessous duquel un pixel est « du fond »
BORD_UNI = 0.97       # part des pixels du bord qui doivent avoir la couleur du fond pour que « auto » choisisse « uni »


def chemins_modele():
    """Là où le modèle BiRefNet-general est rangé (les dossiers de rembg, anciens et nouveaux)."""
    l = []
    if os.getenv("REMBG_HOME"):
        l.append(os.path.join(os.path.expanduser(os.getenv("REMBG_HOME")), "models", "birefnet-general", "birefnet-general.onnx"))
    if os.getenv("U2NET_HOME"):
        l.append(os.path.join(os.path.expanduser(os.getenv("U2NET_HOME")), "birefnet-general.onnx"))
    l.append(os.path.join(os.path.expanduser("~"), ".rembg", "models", "birefnet-general", "birefnet-general.onnx"))
    l.append(os.path.join(os.path.expanduser("~"), ".u2net", "birefnet-general.onnx"))
    return l


def modele():
    for c in chemins_modele():
        if os.path.isfile(c) and os.path.getsize(c) > 9e8:
            return c
    return None


# ---------- petits outils d'image en numpy pur (à la place de scipy.ndimage) ----------

def etiqueter(masque):
    """Les zones d'un seul tenant (voisins haut, bas, gauche, droite) : chaque pixel du masque reçoit le numéro de
    sa zone (le plus petit indice de la zone) ; hors masque, le numéro vaut h × w. Propagation du minimum entre
    voisins, avec « saut de pointeur » : quelques dizaines de passes, même sur une grande image."""
    import numpy as np
    h, w = masque.shape
    fond = h * w
    lab = np.where(masque, np.arange(h * w, dtype=np.int64).reshape(h, w), fond)
    while True:
        m = lab.copy()
        np.minimum(m[1:], lab[:-1], out=m[1:])
        np.minimum(m[:-1], lab[1:], out=m[:-1])
        np.minimum(m[:, 1:], lab[:, :-1], out=m[:, 1:])
        np.minimum(m[:, :-1], lab[:, 1:], out=m[:, :-1])
        m[~masque] = fond
        f = m.reshape(-1)
        v = f < fond
        for _ in range(3):
            f[v] = f[f[v]]       # chaque pixel prend le numéro de celui que désigne son numéro (même zone, plus petit)
        if np.array_equal(m, lab):
            return lab
        lab = m


def dilater(b, n):
    """Dilatation en croix, n fois (comme ndimage.binary_dilation sans structure)."""
    for _ in range(n):
        d = b.copy()
        d[1:] |= b[:-1]
        d[:-1] |= b[1:]
        d[:, 1:] |= b[:, :-1]
        d[:, :-1] |= b[:, 1:]
        b = d
    return b


def bords(rgb):
    import numpy as np
    return np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])


def bord_uni(image):
    """La couleur du fond et la part du bord qui l'a : un fond uni se reconnaît là."""
    import numpy as np
    rgb = np.asarray(image.convert("RGB")).astype(np.float32)
    b = bords(rgb)
    ref = np.median(b, axis=0)
    part = float((np.sqrt(((b - ref) ** 2).sum(axis=1)) < SEUIL).mean())
    return part, ref


def fond_uni(image):
    """Le fond qui touche les bords s'en va ; ce que l'objet entoure reste. Bord adouci, sans liseré blanc."""
    import numpy as np
    from PIL import Image
    rgb = np.asarray(image.convert("RGB")).astype(np.float32)
    _, ref = bord_uni(image)
    dist = np.sqrt(((rgb - ref) ** 2).sum(axis=2))
    proche = dist < SEUIL
    etiq = etiqueter(proche)
    touchent = np.unique(bords(etiq[..., None])[:, 0])
    touchent = touchent[touchent < proche.size]
    fond = np.isin(etiq, touchent)
    objet = ~fond
    # les poussières (moins de 0,05 % de l'image) détachées de l'objet partent aussi
    et_o = etiqueter(objet)
    zones, tailles = np.unique(et_o[objet], return_counts=True)
    if len(zones) > 1:
        petits = zones[tailles < objet.size * 0.0005]
        objet &= ~np.isin(et_o, petits)
        fond = ~objet
    # le bord : sur deux pixels de part et d'autre, l'opacité suit l'écart au fond (anticrénelage)
    alpha = objet.astype(np.float32)
    lisiere = dilater(fond, 2) & dilater(objet, 2)
    doux = np.clip((dist - 6.0) / (SEUIL + 20.0 - 6.0), 0.0, 1.0)
    alpha[lisiere] = doux[lisiere]
    # la couleur du fond retirée des pixels à demi transparents : pas de halo blanc sur un fond sombre
    a = alpha[..., None]
    net = np.where(a > 0.02, (rgb - (1.0 - a) * ref) / np.maximum(a, 0.02), rgb)
    rgba = np.dstack([np.clip(net, 0, 255), alpha * 255.0]).astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


def ia(image):
    """BiRefNet-general par onnxruntime : le même calcul que rembg (session « birefnet-general », remove() par défaut)."""
    import numpy as np
    import onnxruntime as ort
    from PIL import Image, ImageOps
    chemin = modele()
    if not chemin:
        raise RuntimeError("le modèle de détourage (BiRefNet-general) n'est pas téléchargé : page Installation du studio")
    img = ImageOps.exif_transpose(image)
    session = ort.InferenceSession(chemin, providers=["CPUExecutionProvider"])
    a = np.array(img.convert("RGB").resize((1024, 1024), Image.Resampling.LANCZOS)).astype(np.float64)
    a = a / max(np.max(a), 1e-6)
    moy, ecart = (0.485, 0.456, 0.406), (0.229, 0.224, 0.225)
    x = np.stack([(a[:, :, c] - moy[c]) / ecart[c] for c in range(3)])[None].astype(np.float32)
    sortie = session.run(None, {session.get_inputs()[0].name: x})[0][:, 0, :, :]
    pred = 1 / (1 + np.exp(-sortie))
    pred = np.squeeze((pred - pred.min()) / (pred.max() - pred.min()))
    masque = Image.fromarray((pred * 255).astype("uint8"), mode="L").resize(img.size, Image.Resampling.LANCZOS)
    return Image.composite(img.convert("RGBA"), Image.new("RGBA", img.size, 0), masque)


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "erreur": "usage : detourer.py <entree> <sortie.png> [ia|uni|auto]"}))
        return 1

    entree, sortie = sys.argv[1], sys.argv[2]
    methode = sys.argv[3] if len(sys.argv) > 3 else "ia"
    debut = time.time()
    try:
        from PIL import Image
        import numpy  # noqa: F401
        if methode in ("ia", "auto"):
            import onnxruntime  # noqa: F401  (absent ou bloqué par Windows : le studio saura quoi dire)
    except Exception as e:
        print(json.dumps({"ok": False, "erreur": "le détourage local n'est pas installé sur ce poste : " + str(e)}))
        return 1

    try:
        image = Image.open(entree)
        part = None
        if methode == "auto":
            part, _ = bord_uni(image)
            methode = "uni" if part >= BORD_UNI else "ia"
        decoupe = fond_uni(image) if methode == "uni" else ia(image)
        decoupe.save(sortie)                     # PNG, avec sa couche de transparence
        print(json.dumps({
            "ok": True,
            "secondes": round(time.time() - debut, 1),
            "largeur": decoupe.size[0],
            "hauteur": decoupe.size[1],
            "methode": methode,
            "bordUni": None if part is None else round(part, 3),
            "modele": "birefnet-general" if methode == "ia" else None,
        }))
        return 0
    except Exception as e:
        print(json.dumps({"ok": False, "erreur": str(e)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
