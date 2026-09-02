import { describe, it, expect } from "bun:test";
import { createWindowLocation } from "../../web/src/location-port";
import type { LocationPort } from "../../web/src/credential-store";

describe("createWindowLocation", () => {
  it("has live hash getter that delegates to win.location.hash", () => {
    const fakeLocation = { hash: "#t=initial", origin: "https://example.com" };
    const fakeWindow = { location: fakeLocation } as unknown as Window;

    const port = createWindowLocation(fakeWindow);

    expect(port.hash).toBe("#t=initial");

    // Mutate and observe it reads the new value
    fakeLocation.hash = "#t=updated";
    expect(port.hash).toBe("#t=updated");
  });

  it("has live origin getter that delegates to win.location.origin", () => {
    const fakeLocation = { hash: "", origin: "https://example.com" };
    const fakeWindow = { location: fakeLocation } as unknown as Window;

    const port = createWindowLocation(fakeWindow);

    expect(port.origin).toBe("https://example.com");

    // Mutate and observe it reads the new value
    fakeLocation.origin = "https://new.example.com";
    expect(port.origin).toBe("https://new.example.com");
  });

  it("clearHash calls win.history.replaceState with correct URL", () => {
    const calls: { url: string }[] = [];

    const fakeLocation = {
      hash: "#t=abc",
      origin: "https://example.com",
      pathname: "/app/",
      search: "?a=1",
      href: "https://example.com/app/?a=1#t=abc",
    };

    const fakeHistory = {
      replaceState(_state: any, _title: string | null, url: string) {
        calls.push({ url });
        // Simulate replaceState removing the hash
        fakeLocation.hash = "";
        fakeLocation.href = "https://example.com/app/?a=1";
      },
    };

    const fakeWindow = {
      location: fakeLocation,
      history: fakeHistory,
    } as unknown as Window;

    const port = createWindowLocation(fakeWindow);

    port.clearHash();

    expect(calls.length).toBe(1);
    expect(calls[0]!.url).toBe("/app/?a=1");
    expect(port.hash).toBe("");
  });

  it("clearHash does not call pushState or location.assign/replace", () => {
    let replaceStateCalled = false;
    let pushStateCalled = false;
    let assignCalled = false;
    let replaceCalled = false;
    let hashAssigned = false;
    let hrefAssigned = false;

    const fakeLocation = {
      hash: "#t=abc",
      origin: "https://example.com",
      pathname: "/app/",
      search: "",
    };

    const fakeHistory = {
      replaceState(_state: any, _title: string | null, _url: string) {
        replaceStateCalled = true;
        fakeLocation.hash = "";
      },
      pushState() {
        pushStateCalled = true;
      },
    };

    const fakeWindow = {
      location: new Proxy(fakeLocation, {
        get(target, prop) {
          if (prop === "hash") return target.hash;
          if (prop === "origin") return target.origin;
          if (prop === "pathname") return target.pathname;
          if (prop === "search") return target.search;
          if (prop === "assign") return () => { assignCalled = true; };
          if (prop === "replace") return () => { replaceCalled = true; };
          return (target as any)[prop];
        },
        set(target, prop, value) {
          if (prop === "hash") hashAssigned = true;
          if (prop === "href") hrefAssigned = true;
          return true;
        },
      }),
      history: fakeHistory,
    } as unknown as Window;

    const port = createWindowLocation(fakeWindow);
    port.clearHash();

    expect(replaceStateCalled).toBe(true);
    expect(pushStateCalled).toBe(false);
    expect(assignCalled).toBe(false);
    expect(replaceCalled).toBe(false);
    expect(hashAssigned).toBe(false);
    expect(hrefAssigned).toBe(false);
  });

  it("clearHash does not throw when win.history is absent", () => {
    const fakeWindow = {
      location: { hash: "#t=abc", origin: "https://example.com" },
    } as unknown as Window;

    const port = createWindowLocation(fakeWindow);

    expect(() => port.clearHash()).not.toThrow();
  });

  it("clearHash does not throw when win.history.replaceState is absent", () => {
    const fakeWindow = {
      location: { hash: "#t=abc", origin: "https://example.com" },
      history: {},
    } as unknown as Window;

    const port = createWindowLocation(fakeWindow);

    expect(() => port.clearHash()).not.toThrow();
  });

  it("clearHash falls back to location.replace when replaceState unavailable", () => {
    const calls: { url: string }[] = [];

    const fakeLocation = {
      hash: "#t=abc",
      origin: "https://example.com",
      pathname: "/app/",
      search: "?a=1",
      replace(url: string) {
        calls.push({ url });
      },
    };

    const fakeWindow = {
      location: fakeLocation,
      history: {},
    } as unknown as Window;

    const port = createWindowLocation(fakeWindow);
    port.clearHash();

    expect(calls.length).toBe(1);
    expect(calls[0]!.url).toBe("https://example.com/app/?a=1");
  });

  it("round trip: clearHash updates hash to empty string", () => {
    const fakeLocation = {
      hash: "#t=abc",
      origin: "https://example.com",
      pathname: "/app/",
      search: "",
    };

    const fakeHistory = {
      replaceState() {
        fakeLocation.hash = "";
      },
    };

    const fakeWindow = {
      location: fakeLocation,
      history: fakeHistory,
    } as unknown as Window;

    const port = createWindowLocation(fakeWindow);

    expect(port.hash).toBe("#t=abc");
    port.clearHash();
    expect(port.hash).toBe("");
  });

  it("preserves pathname and search in clearHash", () => {
    const calls: { url: string }[] = [];

    const fakeLocation = {
      hash: "#t=abc",
      origin: "https://example.test",
      pathname: "/app/path",
      search: "?a=1&b=2",
    };

    const fakeHistory = {
      replaceState(_state: any, _title: string | null, url: string) {
        calls.push({ url });
      },
    };

    const fakeWindow = {
      location: fakeLocation,
      history: fakeHistory,
    } as unknown as Window;

    const port = createWindowLocation(fakeWindow);
    port.clearHash();

    expect(calls.length).toBe(1);
    expect(calls[0]!.url).toBe("/app/path?a=1&b=2");
  });

  it("clearHash with no search preserves empty search", () => {
    const calls: { url: string }[] = [];

    const fakeLocation = {
      hash: "#t=abc",
      origin: "https://example.test",
      pathname: "/app",
      search: "",
    };

    const fakeHistory = {
      replaceState(_state: any, _title: string | null, url: string) {
        calls.push({ url });
      },
    };

    const fakeWindow = {
      location: fakeLocation,
      history: fakeHistory,
    } as unknown as Window;

    const port = createWindowLocation(fakeWindow);
    port.clearHash();

    expect(calls.length).toBe(1);
    expect(calls[0]!.url).toBe("/app");
  });
});
