export type Role = "volunteer" | "admin" | "airport" | "bus_captain";
export type DriveStatus = "open" | "assigned" | "done";
export type DriveType = "emergency" | "scheduled";
export type VehicleType = "car" | "minibus" | "bus";

export type VolunteerProfile = {
  id: string;
  pinHash: string;
  seats: number;
};

export type Offer = {
  volunteerId: string;
  etaMinutes: number;
  offeredAt: string;
};

/** Senast rapporterade koordinater från tilldelad volontär (dela plats). */
export type LiveLocation = {
  lat: number;
  lng: number;
  updatedAt: string;
};

export type Drive = {
  id: string;
  pickupAddress: string;
  destinationAddress: string;
  neededAt: string;
  seatsNeeded: number;
  delegateFirstName: string;
  note: string;
  type: DriveType;
  vehicleType: VehicleType;
  status: DriveStatus;
  createdAt: string;
  assignedVolunteerId?: string;
  assignedEtaMinutes?: number;
  offers: Offer[];
  liveLocation?: LiveLocation;
};

export type Notification = {
  id: string;
  message: string;
  createdAt: string;
  senderRole: Role;
  targetRole: "all" | Role;
  targetVolunteerId?: string;
  driveId?: string;
};

export type AppState = {
  volunteers: VolunteerProfile[];
  drives: Drive[];
  notifications: Notification[];
};

export type BusRoute = {
  id: string;
  captainId: string;
  routeCode: string;
  pickupLocation: string;
  destinationLocation: string;
  plannedDeparture: string;
  seatsPlanned: number;
  note: string;
};
