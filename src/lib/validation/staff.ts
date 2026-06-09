import { z } from "zod";

export const staffFormSchema = z
  .object({
    fullName: z.string().trim().min(1, "Full name is required"),
    displayName: z.string().trim().min(1, "Display name is required"),
    role: z.string().trim().min(1, "Role is required"),
    payType: z.enum(["hourly", "salaried"]),
    hourlyRate: z.coerce.number().min(0).optional(),
    monthlySalary: z.coerce.number().min(0).optional(),
    contractedWeeklyHours: z.coerce.number().min(0, "Weekly hours cannot be negative"),
    defaultBreakMinutes: z.coerce.number().min(0),
    startDate: z.string().min(1),
    temporaryPin: z.string().regex(/^\d{4,6}$/, "PIN must be four to six digits"),
    active: z.boolean(),
  })
  .superRefine((value, context) => {
    if (value.payType === "hourly" && (!value.hourlyRate || value.hourlyRate <= 0)) {
      context.addIssue({ code: "custom", path: ["hourlyRate"], message: "Hourly staff require an hourly rate" });
    }
    if (value.payType === "salaried" && (!value.monthlySalary || value.monthlySalary <= 0)) {
      context.addIssue({ code: "custom", path: ["monthlySalary"], message: "Salaried staff require a monthly salary" });
    }
  });

export type StaffFormInput = z.infer<typeof staffFormSchema>;
