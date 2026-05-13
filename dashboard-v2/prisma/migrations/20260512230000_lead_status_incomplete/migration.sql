-- AlterEnum
-- Cas SoWeSoft (12/05/2026 18:06) : trigger sans SIRET, HarvestAPI échoue,
-- Lead créé "shell" sans persona mais visible Fred. INCOMPLETE permet de
-- cacher ces leads de la vue Fred pendant les retries (J+1, J+3, J+7) et
-- de les ré-injecter en NEW dès qu'un enrichissement réussit.
ALTER TYPE "LeadStatus" ADD VALUE 'INCOMPLETE';
