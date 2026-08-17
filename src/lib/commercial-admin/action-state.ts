export type CommercialAdminActionState = {
  ok: boolean;
  message: string;
  oneTimeCode?: string;
};

export const initialCommercialAdminActionState: CommercialAdminActionState = {
  ok: false,
  message: "",
};
