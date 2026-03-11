"use client";

import { useSession, signOut } from "next-auth/react";
import { PageTitle } from "@/components/layout/page-title";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { LogOut } from "lucide-react";

export default function SettingsPage() {
  const { data: session } = useSession();

  const initials = session?.user?.name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase() ?? "U";

  return (
    <>
      <PageTitle title="Profile & Settings" />

      <div className="max-w-xl">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your Profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16">
                <AvatarFallback className="text-xl">{initials}</AvatarFallback>
              </Avatar>
              <div>
                <p className="text-lg font-semibold">{session?.user?.name}</p>
                <p className="text-sm text-muted-foreground">{session?.user?.email}</p>
                <span className="inline-block mt-1 rounded-full bg-primary/10 text-primary px-3 py-0.5 text-xs font-semibold">
                  {session?.user?.role}
                </span>
              </div>
            </div>

            <Button variant="destructive" onClick={() => signOut({ callbackUrl: "/login" })}>
              <LogOut className="h-4 w-4 mr-2" />
              Sign Out
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
