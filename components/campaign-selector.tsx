import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";

interface Campaign {
  id: string;
  campaignName: string;
}

interface CampaignSelectorProps {
  campaigns: Campaign[];
  selectedCampaignId: string | null;
  onCampaignChange: (campaignId: string) => void;
  label?: string;
  placeholder?: string;
  className?: string;
}

export function CampaignSelector({
  campaigns,
  selectedCampaignId,
  onCampaignChange,
  label = "Campaign",
  placeholder = "Select a campaign",
  className,
}: CampaignSelectorProps) {
  return (
    <div className={className}>
      <Label htmlFor="campaign-select">{label}</Label>
      <Select value={selectedCampaignId || ""} onValueChange={onCampaignChange}>
        <SelectTrigger id="campaign-select">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
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
