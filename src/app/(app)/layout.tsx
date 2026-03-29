import { Sidebar } from "@/components/sidebar";
import { Header } from "@/components/header";
import { AutosaveProvider } from "@/hooks/use-autosave";
import { LiveSyncProvider } from "@/hooks/use-live-sync";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AutosaveProvider>
      <LiveSyncProvider>
        <div className="min-h-screen">
          <Sidebar />
          <Header />
          <main className="ml-64 mt-14 p-8 min-w-0">{children}</main>
        </div>
      </LiveSyncProvider>
    </AutosaveProvider>
  );
}
