import { TruckLoader } from "@/components/brand/TruckLoader";

export default function Loading() {
  return (
    <div className="grid min-h-[50vh] place-items-center">
      <TruckLoader label="Loading your route…" />
    </div>
  );
}
