import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import {
  createPairingTarget,
  type PairingSubmitResult,
} from "../../../web/src/ui/pairing-target";

const SOURCE_PATH = new URL("../../../web/src/ui/pairing-target.ts", import.meta.url);

function createTestWindow() {
  const win = new Window();
  const doc = win.document;
  const root = doc.createElement("div");
  return { win, doc, root };
}

function getParts(root: any) {
  return {
    section: root.querySelector('[data-testid="pairing"]') as any,
    instructions: root.querySelector('[data-testid="pairing-instructions"]') as any,
    input: root.querySelector('[data-testid="pairing-input"]') as any,
    submit: root.querySelector('[data-testid="pairing-submit"]') as any,
    message: root.querySelector('[data-testid="pairing-message"]') as any,
  };
}

function click(win: any, el: any) {
  el.dispatchEvent(new win.Event("click"));
}

describe("createPairingTarget", () => {
  it("AC1: renders the pairing section with input, submit, instructions and message", () => {
    const { root } = createTestWindow();
    createPairingTarget(root as any, { onSubmit: () => ({ ok: true }) });

    const { section, instructions, input, submit, message } = getParts(root);
    expect(section).not.toBeNull();
    expect(instructions).not.toBeNull();
    expect(input).not.toBeNull();
    expect(submit).not.toBeNull();
    expect(message).not.toBeNull();
    // Must be inside the section, not merely present somewhere in root.
    expect(section.contains(instructions)).toBe(true);
    expect(section.contains(input)).toBe(true);
    expect(section.contains(submit)).toBe(true);
    expect(section.contains(message)).toBe(true);
  });

  it("AC2: clicking submit calls deps.onSubmit exactly once with the trimmed value", () => {
    const { win, root } = createTestWindow();
    const calls: string[] = [];
    createPairingTarget(root as any, {
      onSubmit: (text) => {
        calls.push(text);
        return { ok: true };
      },
    });
    const { input, submit } = getParts(root);
    input.value = "  tok-abc  ";
    click(win, submit);

    expect(calls).toEqual(["tok-abc"]);
  });

  it("AC3: empty/whitespace-only input does not call onSubmit and shows the paste-prompt message", () => {
    const { win, root } = createTestWindow();
    const calls: string[] = [];
    createPairingTarget(root as any, {
      onSubmit: (text) => {
        calls.push(text);
        return { ok: true };
      },
    });
    const { input, submit, message } = getParts(root);

    input.value = "";
    click(win, submit);
    expect(calls).toEqual([]);
    expect(message.textContent).toBe("Paste the pairing URL or token from your Mac.");

    input.value = "   ";
    click(win, submit);
    expect(calls).toEqual([]);
    expect(message.textContent).toBe("Paste the pairing URL or token from your Mac.");
  });

  it("AC4: on ok:true, clears input value and message", () => {
    const { win, root } = createTestWindow();
    createPairingTarget(root as any, { onSubmit: () => ({ ok: true }) });
    const { input, submit, message } = getParts(root);

    input.value = "tok-abc";
    click(win, submit);

    expect(input.value).toBe("");
    expect(message.textContent).toBe("");
  });

  it("AC5: on ok:false, shows the message and leaves input.value unchanged", () => {
    const { win, root } = createTestWindow();
    const failMessage = "Pairing needed (unauthorized): ...";
    createPairingTarget(root as any, {
      onSubmit: () => ({ ok: false, message: failMessage }),
    });
    const { input, submit, message } = getParts(root);

    input.value = "tok-typo";
    click(win, submit);

    expect(message.textContent).toBe(failMessage);
    expect(input.value).toBe("tok-typo");
  });

  describe("AC6: leak assertions -- the ones this task exists for", () => {
    const SECRET = "SECRET-TOKEN-VALUE-9f3a";

    function assertNoLeakInAttributes(root: any, doc: any, titleBefore: string) {
      expect(root.innerHTML).not.toContain(SECRET);
      const input = root.querySelector('[data-testid="pairing-input"]') as any;
      expect(input.getAttribute("value")).toBeNull();
      expect(input.outerHTML).not.toContain(SECRET);
      expect(doc.title).toBe(titleBefore);
      expect(doc.title).not.toContain(SECRET);

      const all = root.querySelectorAll("*");
      for (const el of Array.from(all) as any[]) {
        for (const attr of Array.from(el.attributes ?? []) as any[]) {
          expect(attr.value).not.toContain(SECRET);
        }
      }
    }

    it("after a successful pair, the token reaches no attribute, no title, no outerHTML", () => {
      const { doc, root } = createTestWindow();
      const titleBefore = doc.title;
      const target = createPairingTarget(root as any, { onSubmit: () => ({ ok: true }) });
      const { input, submit } = getParts(root);

      input.value = SECRET;
      submit.click();

      assertNoLeakInAttributes(root, doc, titleBefore);
      // Successful pair clears the input entirely -- no exception needed here.
      expect(input.value).toBe("");
    });

    it("after an unsuccessful pair, the token reaches no attribute, no title, no outerHTML -- except the live .value property, which legitimately still holds it so the human can correct a typo (AC5)", () => {
      const { doc, root } = createTestWindow();
      const titleBefore = doc.title;
      const target = createPairingTarget(root as any, {
        onSubmit: () => ({ ok: false, message: "nope" }),
      });
      const { input, submit } = getParts(root);

      input.value = SECRET;
      submit.click();

      assertNoLeakInAttributes(root, doc, titleBefore);
      // The live DOM `.value` property (not the `value` attribute, not
      // outerHTML/innerHTML serialisation, not any other element's
      // attribute) is the one permitted exception: the human must be able
      // to see and correct what they typed after a failed pair.
      expect(input.value).toBe(SECRET);
    });

    it("the module source never touches document.title, window.location, localStorage or console", () => {
      const source = readFileSync(SOURCE_PATH, "utf8");
      expect(source).not.toContain("document.title");
      expect(source).not.toContain("window.location");
      expect(source).not.toContain("localStorage");
      expect(source).not.toContain("console.");
    });
  });

  it("AC7: onSubmit throwing is caught, shows the generic failure message, and does not propagate", () => {
    const { win, root } = createTestWindow();
    createPairingTarget(root as any, {
      onSubmit: () => {
        throw new Error("boom");
      },
    });
    const { input, submit, message } = getParts(root);

    input.value = "tok-abc";
    expect(() => click(win, submit)).not.toThrow();

    expect(message.textContent).toBe(
      "Pairing failed. Check the URL or token and try again."
    );
    // "leave the input alone" -- unchanged from what was typed.
    expect(input.value).toBe("tok-abc");
  });

  it("AC8: showMessage sets and clears the message without touching the input", () => {
    const { root } = createTestWindow();
    const target = createPairingTarget(root as any, { onSubmit: () => ({ ok: true }) });
    const { input, message } = getParts(root);
    input.value = "untouched";

    target.showMessage("hi");
    expect(message.textContent).toBe("hi");
    expect(input.value).toBe("untouched");

    target.showMessage(null);
    expect(message.textContent).toBe("");
    expect(input.value).toBe("untouched");
  });

  it("AC9: destroy() removes the pairing section, and is safe to call twice", () => {
    const { root } = createTestWindow();
    const target = createPairingTarget(root as any, { onSubmit: () => ({ ok: true }) });

    expect(root.querySelector('[data-testid="pairing"]')).not.toBeNull();
    target.destroy();
    expect(root.querySelector('[data-testid="pairing"]')).toBeNull();
    expect(() => target.destroy()).not.toThrow();
  });
});
