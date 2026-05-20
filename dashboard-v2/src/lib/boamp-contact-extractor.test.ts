import { describe, it, expect } from "vitest";
import { extractBoampContact, isServiceAlias } from "./boamp-contact-extractor";

/** Helper pour construire un payload TED-eForms minimal avec organisations. */
function makePayload(orgs: Array<{
  name: string;
  fullName?: string;
  jobTitle?: string;
  email?: string;
  phone?: string;
  website?: string;
}>) {
  const orgArr = orgs.map((o) => ({
    "efac:Company": {
      "cac:PartyName": { "cbc:Name": { "@languageID": "FRA", "#text": o.name } },
      ...(o.website ? { "cbc:WebsiteURI": o.website } : {}),
      ...(o.fullName || o.email || o.phone
        ? {
            "cac:Contact": {
              ...(o.fullName ? { "cbc:Name": o.fullName } : {}),
              ...(o.jobTitle ? { "cbc:JobTitle": o.jobTitle } : {}),
              ...(o.phone ? { "cbc:Telephone": o.phone } : {}),
              ...(o.email ? { "cbc:ElectronicMail": o.email } : {}),
            },
          }
        : {}),
    },
  }));
  return {
    EFORMS: {
      ContractNotice: {
        "ext:UBLExtensions": {
          "ext:UBLExtension": {
            "ext:ExtensionContent": {
              "efext:EformsExtension": {
                "efac:Organizations": {
                  "efac:Organization": orgArr.length === 1 ? orgArr[0] : orgArr,
                },
              },
            },
          },
        },
      },
    },
  };
}

describe("extractBoampContact", () => {
  it("extrait MEHADDI Belkacem du payload CNFPT (cas réel)", () => {
    const payload = makePayload([
      { name: "Avenue-Web Systèmes", email: "publications-joue@aws-france.com" },
      {
        name: "CNFPT - Direction de l'achat public",
        fullName: "MEHADDI Belkacem",
        jobTitle: "Directeur Général",
        email: "achat.public@cnfpt.fr",
        phone: "0155274400",
        website: "http://www.cnfpt.fr",
      },
      { name: "Tribunal administratif de Paris", email: "greffe.ta-paris@juradm.fr" },
    ]);
    const c = extractBoampContact(payload, "CNFPT - Direction de l'achat public");
    expect(c.matchKind).toBe("exact");
    expect(c.fullName).toBe("MEHADDI Belkacem");
    expect(c.firstName).toBe("Belkacem");
    expect(c.lastName).toBe("MEHADDI");
    expect(c.jobTitle).toBe("Directeur Général");
    expect(c.email).toBe("achat.public@cnfpt.fr");
    expect(c.phone).toBe("0155274400");
  });

  it("préserve l'alias service (UCANSS Département Achat) sans splitter", () => {
    const payload = makePayload([
      {
        name: "Ucanss (Union des Caisses Nationales de Securite Sociale)",
        fullName: "Département Achat Ucanss",
        email: "achat@ucanss.fr",
        phone: "01 45 38 81 20",
      },
    ]);
    const c = extractBoampContact(payload, "UCANSS");
    expect(c.fullName).toBe("Département Achat Ucanss");
    expect(c.firstName).toBeUndefined();
    expect(c.lastName).toBeUndefined();
    expect(c.email).toBe("achat@ucanss.fr");
    expect(c.phone).toBe("0145388120");
  });

  it("match fuzzy quand le nomacheteur est partiel", () => {
    const payload = makePayload([
      {
        name: "Centre National de la Fonction Publique Territoriale",
        fullName: "DUPONT Jean",
        jobTitle: "DSI",
        email: "jean@cnfpt.fr",
      },
    ]);
    const c = extractBoampContact(payload, "Centre National Fonction Publique Territoriale");
    expect(c.matchKind).toBe("fuzzy");
    expect(c.firstName).toBe("Jean");
    expect(c.lastName).toBe("DUPONT");
  });

  it("retourne none si payload sans contacts utiles", () => {
    const payload = makePayload([
      { name: "Avenue-Web Systèmes", email: "publications-joue@aws-france.com" },
    ]);
    const c = extractBoampContact(payload, "CNFPT");
    // Avenue-Web est filtré par TECH_BACKOFFICE_RE même sans nomacheteur match
    expect(c.matchKind).toBe("none");
  });

  it("retourne none sur payload vide ou mal formé", () => {
    expect(extractBoampContact({}, "X").matchKind).toBe("none");
    expect(extractBoampContact(null, "X").matchKind).toBe("none");
    expect(extractBoampContact("not-json{", "X").matchKind).toBe("none");
  });

  it("accepte payload donnees en string JSON", () => {
    const payload = makePayload([
      { name: "MAIRIE TEST", fullName: "MARTIN Sophie", jobTitle: "DSI", email: "s@m.fr" },
    ]);
    const c = extractBoampContact(JSON.stringify(payload), "MAIRIE TEST");
    expect(c.matchKind).toBe("exact");
    expect(c.firstName).toBe("Sophie");
  });

  it("fallback : prend la 1ère org non-tech-backoffice avec fullName si pas de match", () => {
    const payload = makePayload([
      { name: "Avenue-Web Systèmes", email: "publications-joue@aws-france.com" },
      {
        name: "Tribunal administratif de Paris",
        fullName: "GREFFE Paris",
        email: "greffe@ta.fr",
      },
      {
        name: "MAIRIE INCONNUE",
        fullName: "DURAND Marc",
        jobTitle: "Maire",
        email: "marc@mairie.fr",
      },
    ]);
    const c = extractBoampContact(payload, "Toto Inexistant");
    expect(c.matchKind).toBe("fallback");
    expect(c.firstName).toBe("Marc");
    expect(c.lastName).toBe("DURAND");
  });
});

describe("isServiceAlias", () => {
  it.each([
    ["Département Achat Ucanss", true],
    ["SERVICE COMMANDE PUBLIQUE", true],
    ["Direction des achats", true],
    ["Cellule marchés publics", true],
    ["MEHADDI Belkacem", false],
    ["DUPONT Jean", false],
    [undefined, false],
  ])("isServiceAlias(%s) === %s", (input, expected) => {
    expect(isServiceAlias(input)).toBe(expected);
  });
});
