import { describe, it, expect } from "vitest";
import {
  parseShopSettings,
  settingsWarnings,
  SettingsError,
  ANNOUNCEMENT_MAX,
  ABOUT_BODY_MAX,
} from "../src/lib/shop-settings";

const form = (over: Record<string, unknown> = {}) => ({
  shopName: "Anil Crackers",
  minOrderValue: "2500",
  ...over,
});

const field = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (err) {
    return (err as SettingsError).field;
  }
  return undefined;
};

describe("the customer notice", () => {
    it("stores the message with its tone when switched on", () => {
      const s = parseShopSettings(
        form({
          announcement: "Orders after 18 October are delivered after Diwali.",
          announcementTone: "urgent",
          announcementOn: true,
        }),
      );
      expect(s.themeConfig.announcement).toBe(
        "Orders after 18 October are delivered after Diwali.",
      );
      expect(s.themeConfig.announcementTone).toBe("urgent");
      expect(s.themeConfig.announcementOn).toBe(true);
    });

    it("keeps the text when the notice is switched off", () => {
      // A shop reuses the same message every season; deleting it on unticking
      // the box would mean retyping it each time.
      const s = parseShopSettings(
        form({ announcement: "Shop closed on Sunday.", announcementOn: false }),
      );
      expect(s.themeConfig.announcement).toBe("Shop closed on Sunday.");
      expect(s.themeConfig.announcementOn).toBeUndefined();
    });

    it("collapses whitespace from a pasted message", () => {
      const s = parseShopSettings(
        form({ announcement: "  Dispatch resumes\n\n  on Monday.  " }),
      );
      expect(s.themeConfig.announcement).toBe("Dispatch resumes on Monday.");
    });

    it("defaults to the centred popup", () => {
      // A strip along the top of a price list gets scrolled past; a message a
      // shop bothered to write should be read.
      const s = parseShopSettings(form({ announcement: "Hello", announcementOn: true }));
      expect(s.themeConfig.announcementDisplay).toBe("popup");
    });

    it("keeps the top strip when that is what the shop chose", () => {
      const s = parseShopSettings(
        form({ announcement: "Hello", announcementDisplay: "banner" }),
      );
      expect(s.themeConfig.announcementDisplay).toBe("banner");
    });

    it("rejects a display mode that is not one of the two", () => {
      expect(
        field(() =>
          parseShopSettings(form({ announcement: "Hi", announcementDisplay: "fullscreen" })),
        ),
      ).toBe("announcementDisplay");
    });

    it("defaults the tone rather than rejecting a missing one", () => {
      const s = parseShopSettings(form({ announcement: "Hello", announcementOn: true }));
      expect(s.themeConfig.announcementTone).toBe("info");
    });

    it("rejects a tone that is not one of the three", () => {
      // The tone is rendered as a className on a public page.
      expect(
        field(() =>
          parseShopSettings(form({ announcement: "Hi", announcementTone: "blink" })),
        ),
      ).toBe("announcementTone");
    });

    it("refuses to switch on an empty notice", () => {
      expect(field(() => parseShopSettings(form({ announcementOn: true })))).toBe(
        "announcement",
      );
    });

    it("rejects a message longer than the banner can carry", () => {
      expect(
        field(() => parseShopSettings(form({ announcement: "x".repeat(ANNOUNCEMENT_MAX + 1) }))),
      ).toBe("announcement");
    });

    it("leaves the notice out entirely when nothing is written", () => {
      const s = parseShopSettings(form());
      expect(s.themeConfig.announcement).toBeUndefined();
      expect(s.themeConfig.announcementOn).toBeUndefined();
    });
  });

describe("the about block", () => {
    it("stores the headline, intro, mission and vision", () => {
      const s = parseShopSettings(
        form({
          aboutHeadline: "Where every celebration sparks joy",
          aboutIntro: "We have supplied Sivakasi crackers since 1994.",
          aboutMission: "Safe, tested crackers at factory prices.",
          aboutVision: "The shop Tamil Nadu orders from first.",
        }),
      );
      expect(s.themeConfig.about).toEqual({
        headline: "Where every celebration sparks joy",
        intro: "We have supplied Sivakasi crackers since 1994.",
        mission: "Safe, tested crackers at factory prices.",
        vision: "The shop Tamil Nadu orders from first.",
      });
    });

    it("leaves the about block out entirely when nothing is written", () => {
      // The storefront renders nothing at all rather than an empty section.
      expect(parseShopSettings(form()).themeConfig.about).toBeUndefined();
    });

    it("keeps paragraph breaks but collapses pasted blank runs", () => {
      const s = parseShopSettings(
        form({ aboutIntro: "  First para.\n\n\n\n  Second para.  " }),
      );
      expect(s.themeConfig.about?.intro).toBe("First para.\n\nSecond para.");
    });

    it("flattens a headline to one line", () => {
      // It renders at 30px across the page; a newline just breaks the layout.
      const s = parseShopSettings(form({ aboutHeadline: "Welcome to\nR.V.Crackers" }));
      expect(s.themeConfig.about?.headline).toBe("Welcome to R.V.Crackers");
    });

    it("rejects an about text longer than the cap", () => {
      expect(
        field(() => parseShopSettings(form({ aboutIntro: "x".repeat(ABOUT_BODY_MAX + 1) }))),
      ).toBe("aboutIntro");
    });
  });

describe("parseShopSettings", () => {
  it("converts the minimum order from rupees to paise", () => {
    expect(parseShopSettings(form()).minOrderValue).toBe(250000);
    expect(parseShopSettings(form({ minOrderValue: "1,500.50" })).minOrderValue).toBe(150050);
    expect(parseShopSettings(form({ minOrderValue: "Rs. 500" })).minOrderValue).toBe(50000);
  });

  it("allows removing the minimum entirely", () => {
    // A shop selling a few cheap items needs to be able to set this to zero,
    // otherwise the seeded Rs 2,500 default blocks every order.
    expect(parseShopSettings(form({ minOrderValue: "0" })).minOrderValue).toBe(0);
  });

  it("rejects a minimum so high that nobody could check out", () => {
    expect(field(() => parseShopSettings(form({ minOrderValue: "200000" })))).toBe(
      "minOrderValue",
    );
    expect(field(() => parseShopSettings(form({ minOrderValue: "-5" })))).toBe("minOrderValue");
    expect(field(() => parseShopSettings(form({ minOrderValue: "lots" })))).toBe("minOrderValue");
  });

  it("turns blank optional fields into null", () => {
    const s = parseShopSettings(form({ phone: "", upiId: "", gstin: "", tagline: "" }));
    expect(s.phone).toBeNull();
    expect(s.upiId).toBeNull();
    expect(s.gstin).toBeNull();
    expect(s.themeConfig.tagline).toBeUndefined();
  });

  describe("phone numbers", () => {
    it("accepts Indian mobile formats", () => {
      expect(parseShopSettings(form({ phone: "9842012345" })).phone).toBe("9842012345");
      expect(parseShopSettings(form({ whatsapp: "+91 9842012345" })).whatsapp).toBe(
        "+91 9842012345",
      );
    });

    it("rejects landlines and malformed numbers", () => {
      expect(field(() => parseShopSettings(form({ phone: "0442345678" })))).toBe("phone");
      expect(field(() => parseShopSettings(form({ phone: "12345" })))).toBe("phone");
      expect(field(() => parseShopSettings(form({ whatsapp: "not a number" })))).toBe("whatsapp");
    });
  });

  describe("payment details", () => {
    it("accepts a valid UPI id", () => {
      expect(parseShopSettings(form({ upiId: "anilcrackers@okaxis" })).upiId).toBe(
        "anilcrackers@okaxis",
      );
    });

    it("rejects a malformed UPI id", () => {
      for (const bad of ["nope", "@okaxis", "shop@", "shop okaxis"]) {
        expect(field(() => parseShopSettings(form({ upiId: bad })))).toBe("upiId");
      }
    });

    it("normalises IFSC to upper case and validates its shape", () => {
      expect(parseShopSettings(form({ bankIfsc: "hdfc0001234" })).bankIfsc).toBe("HDFC0001234");
      expect(field(() => parseShopSettings(form({ bankIfsc: "HDFC123" })))).toBe("bankIfsc");
      expect(field(() => parseShopSettings(form({ bankIfsc: "1234000HDFC" })))).toBe("bankIfsc");
    });

    it("strips separators from the account number", () => {
      expect(
        parseShopSettings(form({ bankAccountNumber: "5010 0123 456789" })).bankAccountNumber,
      ).toBe("50100123456789");
      expect(field(() => parseShopSettings(form({ bankAccountNumber: "12" })))).toBe(
        "bankAccountNumber",
      );
    });
  });

  it("validates GSTIN and upper-cases it", () => {
    expect(parseShopSettings(form({ gstin: "33abcde1234f1z5" })).gstin).toBe("33ABCDE1234F1Z5");
    expect(field(() => parseShopSettings(form({ gstin: "not-a-gstin" })))).toBe("gstin");
  });

  it("validates the PIN code", () => {
    expect(parseShopSettings(form({ pincode: "626123" })).pincode).toBe("626123");
    expect(field(() => parseShopSettings(form({ pincode: "0626123" })))).toBe("pincode");
  });

  it("validates theme colours, which are injected into a style block", () => {
    const s = parseShopSettings(form({ primaryColor: "#c62828", accentColor: "#fa2" }));
    expect(s.themeConfig.primaryColor).toBe("#c62828");
    expect(s.themeConfig.accentColor).toBe("#fa2");

    expect(field(() => parseShopSettings(form({ primaryColor: "red" })))).toBe("primaryColor");
    expect(
      field(() => parseShopSettings(form({ primaryColor: "#fff;} body{display:none" }))),
    ).toBe("primaryColor");
  });

  it("requires a shop name", () => {
    expect(field(() => parseShopSettings(form({ shopName: "A" })))).toBe("shopName");
  });
});

describe("settingsWarnings", () => {
  const base = {
    minOrderValue: 250000,
    upiId: "shop@okaxis",
    bankAccountNumber: null,
    phone: "9842012345",
  };

  it("is quiet when everything needed is set", () => {
    // Rs 500 items against a Rs 2,500 minimum is five units -- unremarkable.
    expect(settingsWarnings(base, 50000)).toEqual([]);
  });

  it("warns when there is no way for a customer to pay", () => {
    const w = settingsWarnings({ ...base, upiId: null, bankAccountNumber: null }, 20000);
    expect(w.join(" ")).toContain("how to pay");
  });

  it("warns when there is no phone number", () => {
    expect(settingsWarnings({ ...base, phone: null }, 20000).join(" ")).toContain("reach you");
  });

  it("warns when the minimum is unreachable for the catalogue", () => {
    // Exactly the RvCrackers case: one Rs 180 product, Rs 2,500 minimum, so a
    // customer needs 14 boxes before checkout will enable.
    const w = settingsWarnings(base, 18000);
    expect(w.join(" ")).toContain("minimum order is high");
  });

  it("says nothing about the minimum when the shop has no products yet", () => {
    expect(settingsWarnings(base, null)).toEqual([]);
  });
});
