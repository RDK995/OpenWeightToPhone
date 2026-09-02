// The bundle entry point. Re-exports the client surface so the built
// bundle exposes it, and wires the real collaborators behind bootstrap().
//
// Bootstrap adopts a pairing fragment (if present) before constructing the
// API client, so the client receives the adopted baseUrl rather than an empty
// string. The order matters: if adoption happened after the client was
// constructed, the client would still have an empty baseUrl and pairing would
// not work.
//
// The browser entry point calls startApp(), not bootstrap(): an installed
// home-screen app has no fragment and its own storage container, so it may
// have to show the pairing view first. bootstrap() is unchanged and still
// owns everything from the credential onwards.
//
// The browser bootstrap only runs behind `typeof document !== "undefined"`.
// No top-level statement outside that guard may touch `document`, `window`
// or `localStorage` -- importing this module in a non-browser process (e.g.
// test/web/ui/bundle-mount.test.ts) must never throw.
import { mount, type MountHandle } from "./ui/mount";
import { createDomTarget, type DomTarget } from "./ui/dom-target";
import { createActions } from "./ui/actions";
import { buildViewModel, toTelemetryDisplay, describeError } from "./ui/view-model";
import { createLocalStorageStorage } from "./storage-port";
import { createConversationStore } from "./conversation-store";
import {
  createCredentialStore,
  adoptCredentialFromFragment,
  adoptCredentialFromPastedText,
  type LocationPort,
} from "./credential-store";
import { createApiClient } from "./api-client";
import { createSessionCoordinator } from "./session-coordinator";
import { createWindowLocation } from "./location-port";
import {
  createPairingTarget,
  type PairingTarget,
  type PairingSubmitResult,
} from "./ui/pairing-target";
import type { StoragePort } from "./storage-port";
import type { RenderTarget } from "./ui/render-target";
import type { ErrorGuidance } from "./api-client";

export interface BootstrapDeps {
  storage?: StoragePort;
  location?: LocationPort;
  createTarget?: (root: HTMLElement) => RenderTarget;
  createApiClient?: typeof createApiClient;
  // Supplied by startApp() so an `unauthorized` rejection can drop the app
  // back to the pairing view instead of merely printing a notice inside a
  // conversation UI the phone can no longer talk to (M12a-ii criterion 5).
  // Absent for every other caller, whose behaviour is therefore unchanged.
  onUnauthorized?: (error: unknown) => void;
}

export {
  mount,
  createDomTarget,
  createActions,
  buildViewModel,
  toTelemetryDisplay,
  createWindowLocation,
  adoptCredentialFromFragment,
  createCredentialStore,
  createPairingTarget,
};

export type { MountHandle, DomTarget, PairingSubmitResult };

export function bootstrap(root: HTMLElement, deps?: BootstrapDeps): MountHandle {
  // Resolve storage with lazy default
  const storage: StoragePort = deps?.storage !== undefined
    ? deps.storage
    : createLocalStorageStorage(window.localStorage);

  // Resolve location with lazy default
  const location: LocationPort = deps?.location !== undefined
    ? deps.location
    : createWindowLocation(window);

  // Resolve createTarget with lazy default
  const resolvedCreateTarget = deps?.createTarget !== undefined
    ? deps.createTarget
    : createDomTarget;

  // Resolve createApiClient with lazy default
  const resolvedCreateApiClient = deps?.createApiClient !== undefined
    ? deps.createApiClient
    : createApiClient;

  const store = createConversationStore(storage);
  const credentialStore = createCredentialStore(storage);

  // Adopt credential from fragment BEFORE reading it for the API client
  adoptCredentialFromFragment(credentialStore, location);

  // No credential stored yet is expected before pairing (M11): bootstrap
  // must still mount and paint an empty conversation list rather than
  // throwing, so M10's on-device check is possible before pairing exists.
  const credential = credentialStore.getCredential();
  const apiClient = resolvedCreateApiClient({
    baseUrl: credential?.baseUrl ?? "",
    getToken: () => credentialStore.getToken(),
  });

  const coordinator = createSessionCoordinator({
    apiClient,
    conversationStore: store,
  });

  const target = resolvedCreateTarget(root);
  const handle = mount({ target, coordinator, store });

  // The DOM target is constructed before mount(), so the actions map and the
  // controller can only be supplied afterwards.
  if ("attach" in target && typeof (target as DomTarget).attach === "function") {
    (target as DomTarget).attach({ actions: handle.actions, controller: handle });
  }

  // Populate the profile selector. Fire-and-forget: a failure here must never
  // stop the app mounting. The harness returns 401 to an unauthenticated
  // request, so an unpaired or no-longer-authorised phone hits this catch
  // and must be told so via the notice region (BLOCKER 2, M12-C1T2).
  coordinator
    .listProfiles()
    .then((profiles) => handle.setProfiles(profiles))
    .catch((error) => {
      // An `unauthorized` rejection means the stored token is no longer good,
      // so a caller that knows how to re-pair (startApp) takes it instead of
      // the notice region. Matched on the structured guidance code, never on
      // the message string. Every other code, and every caller that supplies
      // no handler, keeps today's behaviour exactly.
      if (deps?.onUnauthorized !== undefined && isUnauthorized(error)) {
        deps.onUnauthorized(error);
        return;
      }
      handle.setNotice(describeError(error));
    });

  return handle;
}

// Narrows a rejection reason to one carrying api-client.ts's ErrorGuidance
// with code "unauthorized". Guarded exactly as view-model.ts's isErrorGuidance
// guards it, so a value that merely happens to have a `guidance` property
// cannot masquerade as one.
function isUnauthorized(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("guidance" in error)) {
    return false;
  }
  const guidance = (error as { guidance: unknown }).guidance;
  return (
    typeof guidance === "object" &&
    guidance !== null &&
    typeof (guidance as ErrorGuidance).code === "string" &&
    typeof (guidance as ErrorGuidance).title === "string" &&
    typeof (guidance as ErrorGuidance).detail === "string" &&
    (guidance as ErrorGuidance).code === "unauthorized"
  );
}

// Shown when a paste is neither a pairing URL nor a usable bare token. Names
// the exact command to run on the Mac, because the phone has no address bar
// and no other way out of this state.
const PAIRING_HELP_MESSAGE =
  "That does not look like a pairing URL or token. On your Mac, run: bun run pair --show-url";

export interface AppHandle {
  /** True once a credential is stored and the conversation UI is mounted. */
  readonly paired: boolean;
  /** The mounted conversation UI, or null while the pairing view is showing. */
  readonly mount: MountHandle | null;
  /** Drives the pairing view programmatically; same contract as clicking Pair. */
  submitPairing(pastedText: string): PairingSubmitResult;
}

// The app-level state machine: unpaired -> paired -> unauthorized -> unpaired.
//
// It exists because an installed home-screen app on iOS gets its own storage
// container, separate from Safari's, and launches at start_url with an empty
// fragment. A token captured by scanning a QR code in Safari is therefore
// invisible to it, and it has no address bar in which to enter a #t= URL. The
// only way in is an in-app pairing screen.
//
// bootstrap() is left untouched and still owns the paired app; startApp() only
// decides which of the two views is on screen.
export function startApp(root: HTMLElement, deps?: BootstrapDeps): AppHandle {
  // Same lazy defaults bootstrap() uses -- resolved once here and passed
  // through, so the credential adopted below is the one bootstrap() sees.
  const storage: StoragePort = deps?.storage !== undefined
    ? deps.storage
    : createLocalStorageStorage(window.localStorage);

  const location: LocationPort = deps?.location !== undefined
    ? deps.location
    : createWindowLocation(window);

  const credentialStore = createCredentialStore(storage);

  // The Safari path, unchanged: a QR-scanned #t= URL pairs before anything is
  // painted, so the pairing screen is never shown to a user who does not need
  // it. This must run before the credential is read.
  adoptCredentialFromFragment(credentialStore, location);

  // Exactly one of these is non-null at a time. Whichever view is being left
  // is released before the one being entered is constructed, so a stale
  // handle can never keep painting into a root that has moved on.
  let mountHandle: MountHandle | null = null;
  let pairingTarget: PairingTarget | null = null;

  function releasePairingTarget(): void {
    const leaving = pairingTarget;
    pairingTarget = null;
    if (leaving !== null) {
      leaving.destroy();
    }
  }

  function enterPaired(): PairingSubmitResult {
    releasePairingTarget();
    try {
      mountHandle = bootstrap(root, { ...deps, storage, location, onUnauthorized });
      return { ok: true };
    } catch (error) {
      // The pairing view was already released above, so a throw here (from a
      // synchronous createTarget/createApiClient failure) would otherwise
      // leave the root empty with no view and no control to touch. The
      // credential that got us into this branch is presumably what triggered
      // it, so clear it too -- otherwise a relaunch reads the same credential
      // and lands right back in this same throw, permanently.
      credentialStore.clear();
      const message = describeError(error);
      enterUnpaired(message);
      return { ok: false, message };
    }
  }

  function enterUnpaired(message: string | null): void {
    mountHandle = null;
    releasePairingTarget();
    pairingTarget = createPairingTarget(root, { onSubmit });
    if (message !== null) {
      pairingTarget.showMessage(message);
    }
  }

  function onSubmit(pastedText: string): PairingSubmitResult {
    const credential = adoptCredentialFromPastedText(
      credentialStore,
      pastedText,
      location.origin
    );

    if (credential === null) {
      return { ok: false, message: PAIRING_HELP_MESSAGE };
    }

    return enterPaired();
  }

  // Fires asynchronously, from bootstrap()'s listProfiles() rejection, and so
  // can arrive after startApp() has returned -- which is why the returned
  // handle reads `paired` and `mount` live rather than snapshotting them.
  function onUnauthorized(error: unknown): void {
    credentialStore.clear();
    enterUnpaired(describeError(error));
  }

  if (credentialStore.getCredential() !== null) {
    enterPaired();
  } else {
    enterUnpaired(null);
  }

  return {
    get paired(): boolean {
      return mountHandle !== null;
    },
    get mount(): MountHandle | null {
      return mountHandle;
    },
    submitPairing(pastedText: string): PairingSubmitResult {
      return onSubmit(pastedText);
    },
  };
}

if (typeof document !== "undefined") {
  document.documentElement.dataset.appShell = "ready";

  const root = document.getElementById("app");
  if (root) {
    startApp(root);
  }

  // Register the service worker if available
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // Swallow registration errors; a failed registration must never break the app
    });
  }
}
