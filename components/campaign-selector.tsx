import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface Campaign {
  id: string;
  campaignName: string;
}

// Sentinel value for the "All Campaigns" option. Radix Select items can't use an
// empty string, so we map this sentinel to `null` at the callback boundary.
const ALL_CAMPAIGNS_VALUE = "__all__";

interface CampaignSelectorProps {
  campaigns: Campaign[];
  selectedCampaignId: string | null;
  onCampaignChange: (campaignId: string | null) => void;
  label?: string;
  placeholder?: string;
  className?: string;
  /** When true, adds an "All Campaigns" option that selects `null`. */
  includeAllOption?: boolean;
  allOptionLabel?: string;
}

export function CampaignSelector({
  campaigns,
  selectedCampaignId,
  onCampaignChange,
  label = "Campaign",
  placeholder = "Select a campaign",
  className,
  includeAllOption = false,
  allOptionLabel = "All Campaigns",
}: CampaignSelectorProps) {
  const value =
    includeAllOption && !selectedCampaignId ? ALL_CAMPAIGNS_VALUE : selectedCampaignId || "";

  return (
    <div className={cn("space-y-1", className)}>
      <Label htmlFor="campaign-select" className="text-sm font-medium">{label}</Label>
      <Select
        value={value}
        onValueChange={(v) => onCampaignChange(v === ALL_CAMPAIGNS_VALUE ? null : v)}
      >
        <SelectTrigger id="campaign-select">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {includeAllOption && (
            <SelectItem value={ALL_CAMPAIGNS_VALUE}>{allOptionLabel}</SelectItem>
          )}
          {campaigns.length === 0 ? (
            <div className="p-2 text-sm text-muted-foreground">No campaigns available</div>
          ) : (
            campaigns.map((campaign) => (
              <SelectItem key={campaign.id} value={campaign.id}>
                {campaign.campaignName}
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
    </div>
  );
}
