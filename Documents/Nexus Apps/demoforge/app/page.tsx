import { LandingFooter } from "@/components/marketing/LandingFooter";
import { LandingShowcase } from "@/components/marketing/LandingShowcase";

export default function Home() {
  return (
    <div className="flex min-h-full flex-col">
      <LandingShowcase />
      <LandingFooter />
    </div>
  );
}
