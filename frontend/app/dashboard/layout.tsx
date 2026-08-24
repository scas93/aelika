import { SessionProvider } from "@/lib/session-context";
import DashboardNav from "./nav";
import DashboardTopbar from "./topbar";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <div className="flex min-h-screen w-full bg-admin-bg font-admin">
        <DashboardNav />
        <div className="flex flex-1 flex-col">
          <DashboardTopbar />
          <main className="mx-auto w-full max-w-[920px] flex-1 p-8">{children}</main>
        </div>
      </div>
    </SessionProvider>
  );
}
