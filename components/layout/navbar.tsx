"use client";

import Image from "next/image";
import { Menu, LogOut } from "lucide-react";
import { signOut, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

interface NavbarProps {
  onMenuClick: () => void;
}

export function Navbar({ onMenuClick }: NavbarProps) {
  const { data: session } = useSession();
  const router = useRouter();

  const initials = session?.user?.name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase() ?? "U";

  const handleSignOut = async () => {
    await signOut({ redirect: false });
    router.push("/login");
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b bg-card px-4 lg:px-6">
      {/* Left */}
      <div className="flex items-center gap-3">
        <button className="lg:hidden" onClick={onMenuClick}>
          <Menu className="h-6 w-6" />
        </button>
        {/* Logo only visible on mobile when sidebar is hidden */}
        <Image
          src="/ops.png"
          alt="OpsPulse 360"
          width={40}
          height={40}
          className="h-10 w-10 object-contain lg:hidden"
        />
      </div>

      {/* Right */}
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <div className="hidden sm:flex items-center gap-2 text-sm">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="text-xs">{initials}</AvatarFallback>
          </Avatar>
          <div className="hidden md:block leading-tight">
            <p className="font-medium">{session?.user?.name}</p>
            <p className="text-xs text-muted-foreground">{session?.user?.role}</p>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={handleSignOut} title="Sign out">
          <LogOut className="h-5 w-5" />
        </Button>
      </div>
    </header>
  );
}
