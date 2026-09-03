// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import CredentialExposurePanel from "@/components/breach/CredentialExposurePanel";
import type { CredentialExposure } from "@/lib/analysis/credentialExposure";

afterEach(cleanup);

const exp = (o: Partial<CredentialExposure> = {}): CredentialExposure => ({
  distinctPasswords: 0, pairs: 0, capped: false, samples: [],
  passwordBreaches: 0, stealerLogs: 0, stealerPasswords: 0,
  exposed: true, reuse: "exposed", ...o,
});

describe("<CredentialExposurePanel>", () => {
  it("renders nothing when there is no exposure", () => {
    const { container } = render(
      <CredentialExposurePanel exposure={exp({ exposed: false })} subject="email address" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows breach-only exposure without a COMB line or samples", () => {
    render(<CredentialExposurePanel exposure={exp({ passwordBreaches: 3 })} subject="email address" />);
    expect(screen.getByText("PASSWORD EXPOSED")).toBeTruthy();
    expect(screen.getByText(/3 breaches exposed a password/)).toBeTruthy();
    expect(screen.queryByText(/leaked credential dumps/)).toBeNull();
    expect(screen.queryByText("Masked previews")).toBeNull();
  });

  it("pluralizes a single password breach", () => {
    render(<CredentialExposurePanel exposure={exp({ passwordBreaches: 1 })} subject="phone number" />);
    expect(screen.getByText(/1 breach exposed a password for this phone number/)).toBeTruthy();
  });

  it("shows COMB-only exposure with masked previews, no breach line", () => {
    render(
      <CredentialExposurePanel
        exposure={exp({ pairs: 1, distinctPasswords: 1, samples: ["a***e"], passwordBreaches: 0 })}
        subject="email address"
      />,
    );
    expect(screen.queryByText(/exposed a password/)).toBeNull();
    expect(screen.getByText(/1 distinct password/)).toBeTruthy();
    expect(screen.getByText(/appears in leaked credential dumps/)).toBeTruthy();
    expect(screen.getByText(/\(1 pair seen\)/)).toBeTruthy();
    expect(screen.getByText("Masked previews")).toBeTruthy();
    expect(screen.getByText("a***e")).toBeTruthy();
  });

  it("shows infostealer captures as exposure for a username, no COMB line", () => {
    render(
      <CredentialExposurePanel
        exposure={exp({ stealerLogs: 2, stealerPasswords: 3, passwordBreaches: 0 })}
        subject="username"
      />,
    );
    expect(screen.getByText("PASSWORD EXPOSED")).toBeTruthy();
    expect(screen.getByText(/2 infostealer logs captured 3 distinct passwords for this username/)).toBeTruthy();
    expect(screen.queryByText(/leaked credential dumps/)).toBeNull();
    expect(screen.queryByText("Masked previews")).toBeNull();
  });

  it("singularises a lone infostealer log and password", () => {
    render(
      <CredentialExposurePanel
        exposure={exp({ stealerLogs: 1, stealerPasswords: 1 })}
        subject="phone number"
      />,
    );
    expect(screen.getByText(/1 infostealer log captured 1 distinct password for this phone number/)).toBeTruthy();
  });

  it("flags likely reuse, with the 'at least' floor and plural forms", () => {
    render(
      <CredentialExposurePanel
        exposure={exp({
          pairs: 5, distinctPasswords: 2, capped: true, samples: ["a***e", "b***f"],
          passwordBreaches: 6, reuse: "likely",
        })}
        subject="email address"
      />,
    );
    expect(screen.getByText("PASSWORD REUSE LIKELY")).toBeTruthy();
    expect(screen.getByText(/At least 2 distinct passwords/)).toBeTruthy();
    expect(screen.getByText(/appear in leaked credential dumps/)).toBeTruthy();
    expect(screen.getByText(/\(5 pairs seen\)/)).toBeTruthy();
    expect(screen.getByText(/6 breaches exposed a password/)).toBeTruthy();
    expect(screen.getByText(/spans more breaches than distinct passwords/)).toBeTruthy();
  });
});
