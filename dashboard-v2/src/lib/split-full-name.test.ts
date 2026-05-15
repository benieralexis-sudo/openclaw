import { describe, it, expect } from "vitest";
import { splitFullName } from "./split-full-name";

describe("splitFullName — particules nobiliaires", () => {
  it("particule française 'de' : Pierre de la Fontaine → firstName=Pierre / lastName=de la Fontaine", () => {
    const r = splitFullName("Pierre de la Fontaine");
    expect(r.firstName).toBe("Pierre");
    expect(r.lastName).toBe("de la Fontaine");
  });

  it("convention RCS majuscules : DUPOND Jean-Marc → firstName=Jean-Marc / lastName=DUPOND", () => {
    const r = splitFullName("DUPOND Jean-Marc");
    expect(r.firstName).toBe("Jean-Marc");
    expect(r.lastName).toBe("DUPOND");
  });

  it("nom simple sans particule : Pierre Dupont", () => {
    const r = splitFullName("Pierre Dupont");
    expect(r.firstName).toBe("Pierre");
    expect(r.lastName).toBe("Dupont");
  });
});

describe("splitFullName — particule italienne 'Di' (bug 15/05/2026 Aurélia)", () => {
  it("REJECT bug actuel : Aurélia Di Martino → firstName=Aurélia / lastName=Di Martino", () => {
    const r = splitFullName("Aurélia Di Martino");
    expect(r.firstName).toBe("Aurélia");
    expect(r.lastName).toBe("Di Martino");
  });

  it("Aurélia Di Marcantonio Di Martino → firstName=Aurélia / lastName=Di Marcantonio Di Martino", () => {
    const r = splitFullName("Aurélia Di Marcantonio Di Martino");
    expect(r.firstName).toBe("Aurélia");
    expect(r.lastName).toBe("Di Marcantonio Di Martino");
  });

  it("particule Della : Marco Della Valle → firstName=Marco / lastName=Della Valle", () => {
    const r = splitFullName("Marco Della Valle");
    expect(r.firstName).toBe("Marco");
    expect(r.lastName).toBe("Della Valle");
  });
});
