import Image from "next/image";
import Link from "next/link";
import { Copyright } from "lucide-react";

export function Footer() {
  return (
    <footer className="w-full text-xs">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-4">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <Copyright className="h-3 w-3" />
            <p>2026</p>
          </div>
          <Image
            alt="Superprism logo"
            className="h-12 w-auto object-cover"
            height={48}
            src="/images/SP_logo.png"
            width={180}
          />
        </div>
        <Link
          href="https://discord.gg/3zQ3NcHm"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs transition-colors hover:text-primary"
        >
          is there anybody out there?
        </Link>
      </div>
    </footer>
  );
}
