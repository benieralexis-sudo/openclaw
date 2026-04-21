#!/bin/bash
# Audit des branches remote stale du repo iFIND / openclaw
# Liste candidats à suppression (branches non-main, anciennes, non iFIND-related)

cd /opt/moltbot

echo "=== Branches remote par âge (top 50 plus anciennes) ==="
git for-each-ref --sort=committerdate --format '%(committerdate:short) %(refname:short)' refs/remotes/origin | head -50

echo ""
echo "=== TOTAL ==="
echo "Branches remote total: $(git branch -r | wc -l)"
echo "Branches de main+ du projet iFIND (depuis 2026-02-07) : $(git for-each-ref --sort=-committerdate --format '%(refname:short)' refs/remotes/origin | head -5 | wc -l)"

echo ""
echo "=== SUPPRESSION BATCH (à exécuter manuellement si validé) ==="
echo "# Supprimer toutes les branches antérieures à 2026-02-01 :"
echo "git for-each-ref --sort=committerdate --format '%(committerdate:short) %(refname:short)' refs/remotes/origin | \\"
echo "  awk '\$1 < \"2026-02-01\" { print \$2 }' | sed 's|origin/||' | \\"
echo "  xargs -I {} git push origin --delete {}"
echo ""
echo "# Toujours tester en mode DRY-RUN d'abord :"
echo "git for-each-ref --sort=committerdate --format '%(committerdate:short) %(refname:short)' refs/remotes/origin | \\"
echo "  awk '\$1 < \"2026-02-01\" { print \$2 }'"
