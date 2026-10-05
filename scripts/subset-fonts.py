#!/usr/bin/env python3
"""Fabrique les woff2 servis par la page a partir des OTF SF Pro Display.

Les OTF d'origine (public/sf-pro-display/, ~2 Mo, non versionnes) restent en
local ; seuls les sous-ensembles woff2 de public/fonts/ sont deployes.

    python3 scripts/subset-fonts.py        # depuis la racine du depot

Dependances : fontTools et brotli (pip install 'fonttools[woff]').
"""
import os
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(RACINE, 'public', 'sf-pro-display')
CIBLE = os.path.join(RACINE, 'public', 'fonts')

# Latin de base + latin-1 accentue + ponctuation typographique courante :
# de quoi reecrire le texte de la page sans avoir a refaire le sous-ensemble.
UNICODES = (list(range(0x20, 0x7F)) + list(range(0xA0, 0x100))
            + [0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2026, 0x20AC])

POLICES = [('sf-pro-display-bold.woff2', 'SFPRODISPLAYBOLD.OTF'),
           ('sf-pro-display-regular.woff2', 'SFPRODISPLAYREGULAR.OTF')]


def main():
    if not os.path.isdir(SOURCE):
        sys.exit('OTF introuvables dans %s' % SOURCE)
    os.makedirs(CIBLE, exist_ok=True)
    for sortie, entree in POLICES:
        chemin = os.path.join(SOURCE, entree)
        police = TTFont(chemin)
        options = subset.Options(flavor='woff2', desubroutinize=True,
                                 layout_features=['kern', 'liga', 'calt'],
                                 notdef_outline=False, recalc_bounds=True,
                                 drop_tables=['bsln', 'trak', 'meta'])
        decoupe = subset.Subsetter(options=options)
        decoupe.populate(unicodes=UNICODES)
        decoupe.subset(police)
        police.flavor = 'woff2'
        dest = os.path.join(CIBLE, sortie)
        police.save(dest)
        print('%-30s %7d o  ->  %-30s %6d o'
              % (entree, os.path.getsize(chemin), sortie, os.path.getsize(dest)))


if __name__ == '__main__':
    main()
