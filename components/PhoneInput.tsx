"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { AsYouType, getCountries, getCountryCallingCode, isValidPhoneNumber } from "libphonenumber-js";
import type { CountryCode } from "libphonenumber-js";
import { CheckCircle2, XCircle, Search, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

function getCountryName(code: CountryCode): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

const ALL_COUNTRIES: { code: CountryCode; name: string; callingCode: string }[] = getCountries()
  .map((code) => ({
    code,
    name: getCountryName(code),
    callingCode: `+${getCountryCallingCode(code)}`,
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

interface Props {
  onLookup: (number: string) => void;
  loading: boolean;
}

type ValidationState = "empty" | "valid" | "invalid";

export default function PhoneInput({ onLookup, loading }: Props) {
  const [country, setCountry] = useState<CountryCode>("US");
  const [raw, setRaw] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [search, setSearch] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fullNumber = raw.startsWith("+") ? raw : `+${getCountryCallingCode(country)}${raw.replace(/\D/g, "")}`;

  let validation: ValidationState = "empty";
  if (raw.trim()) {
    validation = isValidPhoneNumber(fullNumber) ? "valid" : "invalid";
  }

  // Close dropdown on outside click
  useEffect(() => {
    if (!showDropdown) return;
    function handleOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [showDropdown]);

  const handleInput = useCallback((val: string) => {
    const formatter = new AsYouType(country);
    setRaw(formatter.input(val));
  }, [country]);

  const handleCountryChange = (code: CountryCode) => {
    setCountry(code);
    setRaw(""); // reset input — previous format belongs to old country
    setShowDropdown(false);
    setSearch("");
  };

  const filteredCountries = ALL_COUNTRIES.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.callingCode.includes(search) ||
      c.code.toLowerCase().includes(search.toLowerCase())
  );

  const selectedCountry = ALL_COUNTRIES.find((c) => c.code === country);

  const handleSubmit = () => {
    if (validation === "valid") {
      onLookup(fullNumber);
    }
  };

  return (
    <div className="w-full space-y-3">
      <div className="flex gap-2 relative">
        {/* Country selector */}
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setShowDropdown((p) => !p)}
            className="flex items-center gap-1.5 h-12 px-3 terminal-input border rounded-none text-sm whitespace-nowrap hover:border-[#00ff41] transition-colors"
          >
            <span>{selectedCountry?.callingCode}</span>
            <ChevronDown className="w-3 h-3 text-[#00ff41]/60" />
          </button>

          {showDropdown && (
            <div className="absolute top-full left-0 mt-1 w-64 z-50 bg-[#0a0a0a] border border-[#00ff41]/30 shadow-lg shadow-[#00ff41]/10">
              <div className="p-2 border-b border-[#00ff41]/20">
                <input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") { setShowDropdown(false); setSearch(""); }
                    if (e.key === "Enter" && filteredCountries.length === 1) {
                      handleCountryChange(filteredCountries[0].code);
                    }
                  }}
                  placeholder="Search country or code..."
                  className="w-full terminal-input text-xs px-2 py-1.5 rounded-none"
                />
              </div>
              <div className="max-h-56 overflow-y-auto">
                {filteredCountries.map((c) => (
                  <button
                    key={c.code}
                    type="button"
                    onClick={() => handleCountryChange(c.code)}
                    className={cn(
                      "w-full text-left px-3 py-1.5 text-xs flex justify-between hover:bg-[#00ff41]/10 transition-colors",
                      c.code === country && "bg-[#00ff41]/15 text-[#00ff41]"
                    )}
                  >
                    <span>{c.name}</span>
                    <span className="text-[#00ff41]/60">{c.callingCode}</span>
                  </button>
                ))}
                {filteredCountries.length === 0 && (
                  <div className="px-3 py-2 text-xs text-[#00ff41]/40">No results</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Phone number input */}
        <div className="relative flex-1">
          <input
            type="tel"
            value={raw}
            onChange={(e) => handleInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder={`Enter number for ${selectedCountry?.name ?? "selected country"}`}
            className="w-full h-12 pl-4 pr-10 terminal-input text-sm rounded-none font-mono"
            spellCheck={false}
            autoComplete="tel"
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            {validation === "valid" && <CheckCircle2 className="w-4 h-4 text-[#00ff41]" />}
            {validation === "invalid" && raw && <XCircle className="w-4 h-4 text-[#ff3e3e]" />}
          </div>
        </div>

        {/* Execute button */}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={validation !== "valid" || loading}
          className={cn(
            "h-12 px-5 border text-sm font-mono font-bold tracking-widest transition-all flex items-center gap-2",
            validation === "valid" && !loading
              ? "border-[#00ff41] text-[#00ff41] hover:bg-[#00ff41] hover:text-[#0a0a0a] hover:shadow-[0_0_20px_rgba(0,255,65,0.4)] cursor-pointer"
              : "border-[#00ff41]/20 text-[#00ff41]/30 cursor-not-allowed"
          )}
        >
          <Search className="w-4 h-4" />
          {loading ? "SCANNING..." : "EXECUTE LOOKUP"}
        </button>
      </div>

      {/* Status line */}
      <div className="text-xs font-mono">
        {validation === "valid" && (
          <span className="text-[#00ff41]">
            ✓ Valid — will look up: <span className="glow-green">{fullNumber}</span>
          </span>
        )}
        {validation === "invalid" && raw && (
          <span className="text-[#ff3e3e]">
            ✗ Not a valid {selectedCountry?.name} number — include country code (e.g. {selectedCountry?.callingCode}) or switch country
          </span>
        )}
        {validation === "empty" && (
          <span className="text-[#00ff41]/30">
            _ Enter number · country code {selectedCountry?.callingCode} will be prepended automatically
          </span>
        )}
      </div>
    </div>
  );
}
