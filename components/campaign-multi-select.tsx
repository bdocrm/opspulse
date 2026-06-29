"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CampaignOption {
  id: string;
  campaignName: string;
}

interface CampaignMultiSelectProps {
  campaigns: CampaignOption[];
  /** Currently selected campaign ids. */
  value: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
}

/**
 * Searchable multi-select for assigning campaigns to a user.
 *
 * Reuses the existing Checkbox primitive and Tailwind tokens so it matches the
 * rest of the app. Features: searchable + scrollable list, sticky search bar,
 * sticky Select-All row, per-row checkboxes, selected chips/tags inside the
 * trigger, a selected count, and Select All / Clear All. Designed to stay fast
 * with 100+ campaigns (list is plain DOM but virtual-free; filtering is cheap).
 */
export function CampaignMultiSelect({
  campaigns,
  value,
  onChange,
  placeholder = "Select campaigns...",
  disabled = false,
  className,
  id,
}: CampaignMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(() => new Set(value), [value]);

  // Sort options alphabetically for a stable, predictable list.
  const sorted = useMemo(
    () => [...campaigns].sort((a, b) => a.campaignName.localeCompare(b.campaignName)),
    [campaigns]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((c) => c.campaignName.toLowerCase().includes(q));
  }, [sorted, search]);

  // Resolve selected ids to options for chips. Ids without a matching campaign
  // (e.g. a deleted campaign) are simply not rendered as chips.
  const selectedOptions = useMemo(
    () => sorted.filter((c) => selected.has(c.id)),
    [sorted, selected]
  );

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const toggle = (campaignId: string) => {
    if (selected.has(campaignId)) {
      onChange(value.filter((v) => v !== campaignId));
    } else {
      onChange([...value, campaignId]);
    }
  };

  const removeChip = (campaignId: string) => {
    onChange(value.filter((v) => v !== campaignId));
  };

  // Select All / Clear All operate on the currently filtered list so search +
  // Select All can be combined for large campaign sets.
  const filteredIds = filtered.map((c) => c.id);
  const allFilteredSelected =
    filteredIds.length > 0 && filteredIds.every((cid) => selected.has(cid));

  const selectAll = () => {
    const merged = new Set(value);
    filteredIds.forEach((cid) => merged.add(cid));
    onChange(Array.from(merged));
  };

  const clearAll = () => {
    if (search.trim()) {
      // Only clear what is currently visible when a search is active.
      const remove = new Set(filteredIds);
      onChange(value.filter((v) => !remove.has(v)));
    } else {
      onChange([]);
    }
  };

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      {/* Trigger with chips */}
      <button
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-3 py-2 text-left text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          open && "ring-2 ring-ring ring-offset-2"
        )}
      >
        {selectedOptions.length === 0 ? (
          <span className="text-muted-foreground">{placeholder}</span>
        ) : (
          selectedOptions.map((c) => (
            <span
              key={c.id}
              className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
            >
              {c.campaignName}
              <span
                role="button"
                tabIndex={-1}
                aria-label={`Remove ${c.campaignName}`}
                onClick={(e) => {
                  e.stopPropagation();
                  removeChip(c.id);
                }}
                className="rounded-full hover:bg-primary/20"
              >
                <X className="h-3 w-3" />
              </span>
            </span>
          ))
        )}
        <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md">
          {/* Sticky search bar */}
          <div className="sticky top-0 z-10 border-b bg-popover p-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search campaigns..."
                className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>

          {/* Sticky Select All / Clear All + count */}
          <div className="sticky top-[57px] z-10 flex items-center justify-between border-b bg-popover px-3 py-2 text-xs">
            <button
              type="button"
              onClick={allFilteredSelected ? clearAll : selectAll}
              className="font-medium text-primary hover:underline"
            >
              {allFilteredSelected ? "Clear All" : "Select All"}
            </button>
            <span className="text-muted-foreground">{value.length} selected</span>
          </div>

          {/* Scrollable list */}
          <div className="max-h-60 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                No campaigns found
              </p>
            ) : (
              filtered.map((c) => {
                const isSelected = selected.has(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => toggle(c.id)}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground",
                      isSelected && "bg-accent/50"
                    )}
                  >
                    {/* Purely visual checkbox — intentionally NOT a Radix
                        Checkbox (a form control with its own ref/presence/size
                        machinery), which loops when rendered controlled inside
                        this dialog form and a list. */}
                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border border-primary",
                        isSelected && "bg-primary text-primary-foreground"
                      )}
                    >
                      {isSelected && <Check className="h-3 w-3" />}
                    </span>
                    <span className="flex-1 truncate">{c.campaignName}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
