"use client";

import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

interface ExportButtonProps {
  endpoint: string;
  label?: string;
}

export function ExportButton({ endpoint, label = "Export CSV" }: ExportButtonProps) {
  const handleExport = async () => {
    const res = await fetch(endpoint);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "export.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Button variant="outline" size="sm" onClick={handleExport}>
      <Download className="h-4 w-4 mr-2" />
      {label}
    </Button>
  );
}
