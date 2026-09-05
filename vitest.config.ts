import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    // Default env is node (lib + route logic tests). Component render tests opt
    // into jsdom per-file via a `// @vitest-environment jsdom` comment.
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    exclude: ["node_modules", ".next", ".claude"],
    // Hard guard: route handlers write through HV_DATA_DIR (audit log, cases,
    // API keys). Without a default here, any test that exercises a route
    // WITHOUT setting its own temp dir writes into the developer's real ./.data
    // — silently polluting their cases and audit log. Point the whole run at a
    // throwaway directory; suites that need isolation still set their own.
    env: { HV_DATA_DIR: path.resolve(import.meta.dirname, ".vitest-data") },
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      // The pure logic layer (src/lib) is fully covered. Components are being
      // brought under the same 100% gate one at a time — each file listed here
      // has a dedicated test suite proving 100%. Add a component to this list
      // only once its tests hit 100% (or with an explicit `/* v8 ignore */` for
      // a defensive/environment-only branch, matching the lib convention).
      include: [
        "src/lib/**/*.ts",
        // The highest-risk code in the repo: every outbound fetch lives in a
        // route handler, and the CSRF + auth gate lives in proxy.ts. These were
        // outside the gate until 1.4 — tests existed, but nothing enforced that
        // they covered the error paths.
        "src/app/api/**/route.ts",
        "src/proxy.ts",
        // shared/
        "src/components/shared/SimpleLookupInput.tsx",
        "src/components/shared/PanelErrorBoundary.tsx",
        "src/components/shared/HelpPopover.tsx",
        "src/components/shared/ShareButton.tsx",
        "src/components/shared/CopyLinkButton.tsx",
        "src/components/shared/SourceStrip.tsx",
        "src/components/shared/Tilt3D.tsx",
        "src/components/shared/GlanceCard.tsx",
        "src/components/shared/ThemeToggle.tsx",
        "src/components/shared/Term.tsx",
        "src/components/shared/ConsentGate.tsx",
        "src/components/shared/EffectsToggle.tsx",
        "src/components/shared/ThemeProvider.tsx",
        "src/components/shared/CommandPalette.tsx",
        "src/components/shared/OpsecPanel.tsx",
        "src/components/shared/AddToCase.tsx",
        "src/components/shared/RecentLookups.tsx",
        "src/components/shared/BootSequence.tsx",
        "src/components/shared/MatrixRain.tsx",
        "src/components/shared/ReportExport.tsx",
        "src/components/shared/UniversalReportExport.tsx",
        "src/components/shared/SourcesPanel.tsx",
        "src/components/shared/Logo.tsx",
        // osint/
        "src/components/osint/CountryPanel.tsx",
        "src/components/osint/LocationPanel.tsx",
        "src/components/osint/QrCodePanel.tsx",
        "src/components/osint/OsintPivots.tsx",
        // email/
        "src/components/email/EmailOsintPivots.tsx",
        "src/components/email/EmailResultsDashboard.tsx",
        "src/components/email/EmailHeaderTracePanel.tsx",
        // dashboard/
        "src/components/dashboard/LoadingSkeletons.tsx",
        "src/components/dashboard/ScanProgress.tsx",
        "src/components/dashboard/SourceTabs.tsx",
        "src/components/dashboard/HistorySidebar.tsx",
        "src/components/dashboard/BulkLookup.tsx",
        "src/components/dashboard/ResultsDashboard.tsx",
        // cases/ + graph/ + ui/
        "src/components/cases/CasesPanel.tsx",
        "src/components/graph/LinkGraph.tsx",
        "src/components/ui/tabs.tsx",
        // email/ + phone/
        "src/components/email/EmailInput.tsx",
        "src/components/phone/NumberPermutations.tsx",
        "src/components/phone/PhoneInput.tsx",
        "src/components/phone/NumberAnatomyPanel.tsx",
        "src/components/phone/SimIntelPanel.tsx",
        "src/components/phone/PhoneIdentityPanel.tsx",
        "src/components/phone/PentesterPanel.tsx",
        // breach/ + network/ + username/
        "src/components/breach/InfostealerPanel.tsx",
        "src/components/breach/BreachAggregatePanel.tsx",
        "src/components/breach/CredentialExposurePanel.tsx",
        "src/components/breach/BreachPanel.tsx",
        "src/components/breach/LeakCheckPanel.tsx",
        "src/components/shared/AutoPivots.tsx",
        "src/components/shared/PivotRow.tsx",
        "src/components/cases/CaseChanges.tsx",
        "src/components/network/DomainResultsDashboard.tsx",
        "src/components/network/DomainKnownBreachesPanel.tsx",
        "src/components/network/SubdomainTakeoverPanel.tsx",
        "src/components/network/TyposquatPanel.tsx",
        "src/components/network/HttpPosturePanel.tsx",
        "src/components/network/EmailPermutations.tsx",
        "src/components/network/IpResultsDashboard.tsx",
        "src/components/username/UsernameResultsDashboard.tsx",
        "src/components/username/ResolvedIdentityCard.tsx",
        "src/components/username/ExtendedSitesPanel.tsx",
        "src/components/username/AvatarCorrelationPanel.tsx",
        "src/components/wallet/WalletResultsDashboard.tsx",
        "src/components/hash/HashResultsDashboard.tsx",
        "src/components/hash/CryptoWorkbench.tsx",
        "src/components/image/ImageExifPanel.tsx",
      ],
      exclude: ["src/lib/types.ts"],
      // New gated code must ship with tests (or an explicit `/* v8 ignore */` for
      // defensive branches) or this fails the build.
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
