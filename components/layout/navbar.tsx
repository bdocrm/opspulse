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
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b bg-card/95 px-4 backdrop-blur-sm transition-[background-color,border-color] duration-200 motion-reduce:transition-none lg:px-6">
      {/* Left */}
      <div className="flex items-center gap-3">
        <button className="motion-control rounded-md p-1.5 transition-[background-color,transform] duration-150 hover:bg-accent active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden" onClick={onMenuClick} aria-label="Open navigation">
          <Menu className="h-6 w-6" />
        </button>
        {/* Logo only visible on mobile when sidebar is hidden */}
        <Image
          src="/ops.png"
          alt="OpsView 360"
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
        <Button variant="ghost" size="icon" onClick={handleSignOut} title="Sign out" aria-label="Sign out">
          <LogOut className="h-5 w-5" />
        </Button>
      </div>
    </header>
  );
}
