import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  countSignalMatchingPosts,
  filterRecentPosts,
  formatPostsForDossier,
  normalizePost,
  type RecentPost,
} from "./harvestapi-recent-posts";

describe("normalizePost", () => {
  it("extrait text + postedAt + reactions + comments depuis schéma standard", () => {
    const raw = {
      postedAt: "2026-05-10T12:00:00Z",
      text: "On vient d'embaucher 3 QA Engineers",
      reactions: 12,
      comments: 3,
      postUrl: "https://linkedin.com/posts/x",
    };
    expect(normalizePost(raw)).toEqual({
      postedAt: "2026-05-10T12:00:00Z",
      text: "On vient d'embaucher 3 QA Engineers",
      reactions: 12,
      comments: 3,
      postUrl: "https://linkedin.com/posts/x",
    });
  });

  it("tolère schéma alternatif (content/publishedAt/likesCount)", () => {
    const raw = {
      publishedAt: "2026-04-15",
      content: "Notre nouvelle stratégie tech",
      likesCount: 5,
      commentsCount: 2,
    };
    const r = normalizePost(raw);
    expect(r?.text).toBe("Notre nouvelle stratégie tech");
    expect(r?.reactions).toBe(5);
    expect(r?.comments).toBe(2);
  });

  it("retourne null si texte vide", () => {
    expect(normalizePost({ postedAt: "2026-05-10", text: "" })).toBeNull();
    expect(normalizePost({})).toBeNull();
  });

  it("tronque text à 800 chars", () => {
    const longText = "a".repeat(1000);
    const r = normalizePost({ text: longText });
    expect(r?.text).toHaveLength(800);
  });
});

describe("filterRecentPosts", () => {
  const recent: RecentPost = {
    postedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    text: "récent",
    reactions: 0,
    comments: 0,
  };
  const old: RecentPost = {
    postedAt: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString(),
    text: "vieux",
    reactions: 0,
    comments: 0,
  };
  const noDate: RecentPost = {
    postedAt: null,
    text: "date inconnue",
    reactions: 0,
    comments: 0,
  };

  it("garde les posts <90j", () => {
    const filtered = filterRecentPosts([recent, old]);
    expect(filtered).toEqual([recent]);
  });

  it("garde aussi les posts sans date (tolérance)", () => {
    const filtered = filterRecentPosts([noDate]);
    expect(filtered).toEqual([noDate]);
  });

  it("respect du paramètre maxAgeDays personnalisé", () => {
    const filtered = filterRecentPosts([recent, old], 15);
    expect(filtered).toEqual([]); // 30j > 15j
  });
});

describe("countSignalMatchingPosts", () => {
  const posts: RecentPost[] = [
    { postedAt: "2026-05-01", text: "On embauche un QA Engineer", reactions: 0, comments: 0 },
    { postedAt: "2026-04-15", text: "Notre stack DevOps", reactions: 0, comments: 0 },
    { postedAt: "2026-04-01", text: "Cherchons un Head of QA", reactions: 0, comments: 0 },
    { postedAt: "2026-03-20", text: "Notre nouvelle stratégie marketing", reactions: 0, comments: 0 },
  ];

  it("compte les posts matching keywords (case-insensitive)", () => {
    expect(countSignalMatchingPosts(posts, ["qa"])).toBe(2);
    expect(countSignalMatchingPosts(posts, ["QA", "test"])).toBe(2);
    expect(countSignalMatchingPosts(posts, ["devops"])).toBe(1);
    expect(countSignalMatchingPosts(posts, ["aucun match"])).toBe(0);
  });

  it("retourne 0 si keywords vides", () => {
    expect(countSignalMatchingPosts(posts, [])).toBe(0);
  });
});

describe("formatPostsForDossier", () => {
  it("formate un bloc lisible pour Opus", () => {
    const posts: RecentPost[] = [
      {
        postedAt: "2026-05-10T12:00:00Z",
        text: "On vient d'embaucher 3 QA Engineers cette semaine",
        reactions: 12,
        comments: 3,
      },
      {
        postedAt: "2026-04-22T08:00:00Z",
        text: "Notre nouvelle stack Cypress est en prod",
        reactions: 5,
        comments: 1,
      },
    ];
    const formatted = formatPostsForDossier(posts);
    expect(formatted).toContain("POSTS RÉCENTS LINKEDIN DU DÉCIDEUR");
    expect(formatted).toContain("2026-05-10");
    expect(formatted).toContain("12❤ 3💬");
    expect(formatted).toContain("QA Engineers");
    expect(formatted).toContain("Cypress");
  });

  it("retourne string vide si 0 posts", () => {
    expect(formatPostsForDossier([])).toBe("");
  });

  it("cap à 10 posts", () => {
    const many: RecentPost[] = Array.from({ length: 15 }, (_, i) => ({
      postedAt: "2026-05-01",
      text: `Post ${i}`,
      reactions: 0,
      comments: 0,
    }));
    const formatted = formatPostsForDossier(many);
    const lines = formatted.split("\n").filter((l) => l.startsWith("- "));
    expect(lines).toHaveLength(10);
  });

  it("tronque texte long à 150 chars dans le bloc", () => {
    const longPost: RecentPost = {
      postedAt: "2026-05-10",
      text: "x".repeat(300),
      reactions: 0,
      comments: 0,
    };
    const formatted = formatPostsForDossier([longPost]);
    // 150 chars max + format autour
    expect(formatted.match(/x+/)?.[0].length).toBeLessThanOrEqual(150);
  });
});
