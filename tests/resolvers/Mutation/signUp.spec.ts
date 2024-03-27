import "dotenv/config";
import type mongoose from "mongoose";
import { Types } from "mongoose";
import type { InterfaceUser } from "../../../src/models";
import { Organization, AppUserProfile, User } from "../../../src/models";
import { nanoid } from "nanoid";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  LAST_RESORT_SUPERADMIN_EMAIL,
  ORGANIZATION_NOT_FOUND_ERROR,
} from "../../../src/constants";
import type { MutationSignUpArgs } from "../../../src/types/generatedGraphQLTypes";
import { connect, disconnect } from "../../helpers/db";
import type {
  TestOrganizationType,
  TestUserType,
} from "../../helpers/userAndOrg";
import { createTestUserAndOrganization } from "../../helpers/userAndOrg";
import * as uploadEncodedImage from "../../../src/utilities/encodedImageStorage/uploadEncodedImage";
import { signUp as signUpResolverImage } from "../../../src/resolvers/Mutation/signUp";
import type { Document } from "mongoose";

const testImagePath = `${nanoid().toLowerCase()}test.png`;
let MONGOOSE_INSTANCE: typeof mongoose;
let testUser: TestUserType;

let testOrganization: TestOrganizationType;

vi.mock("../../utilities/uploadEncodedImage", () => ({
  uploadEncodedImage: vi.fn(),
}));

vi.mock("../../../src/constants", async () => {
  const constants: object = await vi.importActual("../../../src/constants");
  return {
    ...constants,
    LAST_RESORT_SUPERADMIN_EMAIL: "admin@email.com",
  };
});

beforeAll(async () => {
  MONGOOSE_INSTANCE = await connect();
  const temp = await createTestUserAndOrganization();
  testUser = temp[0];

  testOrganization = temp[1];
});

afterAll(async () => {
  await disconnect(MONGOOSE_INSTANCE);
});

describe("resolvers -> Mutation -> signUp", () => {
  afterEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it(`creates the user and returns the created with adminAprooved=true, accessToken and refreshToken when organization doesn't require user registration`, async () => {
    const email = `email${nanoid().toLowerCase()}@gmail.com`;

    const args: MutationSignUpArgs = {
      data: {
        email,
        firstName: "firstName",
        lastName: "lastName",
        password: "password",
        appLanguageCode: "en",
        selectedOrgainzation: testOrganization?._id.toString(),
      },
    };
    const { signUp: signUpResolver } = await import(
      "../../../src/resolvers/Mutation/signUp"
    );

    const signUpPayload = await signUpResolver?.({}, args, {});

    const createdUser = await User.findOne({
      email,
    })
      .select("-password")
      .lean();
    const appUserProfile = await AppUserProfile.findOne({
      userId: createdUser?._id,
    }).lean();
    expect(appUserProfile?.adminApproved).toBe(true);
    expect(appUserProfile?.isSuperAdmin).toBe(false);
    expect(appUserProfile?.userId).toStrictEqual(createdUser?._id);
    expect(appUserProfile?.appLanguageCode).toBe("en");
    expect({
      user: signUpPayload?.user,
    }).toStrictEqual({
      user: createdUser,
    });

    const updatedOrganization = await Organization.findById(
      testOrganization?._id,
    ).select("members");
    expect(updatedOrganization?.members.includes(testUser?._id)).toBe(true);

    expect(typeof signUpPayload?.accessToken).toEqual("string");
    expect(signUpPayload?.accessToken.length).toBeGreaterThan(1);

    expect(typeof signUpPayload?.refreshToken).toEqual("string");
    expect(signUpPayload?.refreshToken.length).toBeGreaterThan(1);
  });

  it(`creates the user and returns the created with a membership request, adminAprooved=false, accessToken and refreshToken when organization require user registration`, async () => {
    const email = `email${nanoid().toLowerCase()}@gmail.com`;
    const localTestOrganization = await createTestUserAndOrganization(
      true,
      true,
      true,
    );
    const args: MutationSignUpArgs = {
      data: {
        email,
        firstName: "firstName",
        lastName: "lastName",
        password: "password",
        appLanguageCode: "en",
        selectedOrgainzation: localTestOrganization[1]?.id,
      },
    };
    const { signUp: signUpResolver } = await import(
      "../../../src/resolvers/Mutation/signUp"
    );

    const signUpPayload = await signUpResolver?.({}, args, {});
    const createdUser: // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (InterfaceUser & Document<any, any, InterfaceUser>) | null =
      await User.findOne({
        email,
      })
        .select("-password")
        .lean();
    expect({
      user: signUpPayload?.user,
    }).toEqual({
      user: createdUser,
    });
    const appUserProfile = await AppUserProfile.findOne({
      userId: createdUser?._id,
    }).lean();
    expect(appUserProfile?.adminApproved).toBe(false);
    expect(appUserProfile?.isSuperAdmin).toBe(false);
    expect(appUserProfile?.userId).toStrictEqual(createdUser?._id);
    expect(typeof signUpPayload?.accessToken).toEqual("string");
    expect(signUpPayload?.accessToken.length).toBeGreaterThan(1);

    expect(typeof signUpPayload?.refreshToken).toEqual("string");
    expect(signUpPayload?.refreshToken.length).toBeGreaterThan(1);
  });
  it(`when uploadImage is called with newFile `, async () => {
    vi.spyOn(uploadEncodedImage, "uploadEncodedImage").mockImplementation(
      async (encodedImageURL: string) => encodedImageURL,
    );

    const email = `email${nanoid().toLowerCase()}@gmail.com`;

    const args: MutationSignUpArgs = {
      data: {
        email,
        firstName: "firstName",
        lastName: "lastName",
        password: "password",
        appLanguageCode: "en",
        selectedOrgainzation: testOrganization?.id,
      },
      file: testImagePath,
    };

    const signedUpUserPayload = await signUpResolverImage?.({}, args, {});
    await User.findOne({
      email,
    })
      .select("-password")
      .lean();

    const user = await signedUpUserPayload?.user;
    const path = user?.image;
    expect(path).toBe(testImagePath);
  });

  it(`Promotes the user to SUPER ADMIN if the email registering with is same that as provided in configuration file`, async () => {
    const email = LAST_RESORT_SUPERADMIN_EMAIL;
    const args: MutationSignUpArgs = {
      data: {
        email,
        firstName: "firstName",
        lastName: "lastName",
        password: "password",
        appLanguageCode: "en",
        selectedOrgainzation: testOrganization?.id,
      },
    };
    const { signUp: signUpResolver } = await import(
      "../../../src/resolvers/Mutation/signUp"
    );
    await signUpResolver?.({}, args, {});
    const createdUser = await User.findOne({
      email,
    });
    const createdAppUserProfile = await AppUserProfile.findOne({
      userId: createdUser?._id,
    });
    expect(createdAppUserProfile?.isSuperAdmin).toEqual(true);
    expect(createdAppUserProfile?.adminApproved).toBeTruthy();
  });
  it(`Check if the User is not being promoted to SUPER ADMIN automatically`, async () => {
    const localTestOrganization = await createTestUserAndOrganization(
      true,
      true,
      true,
    );
    const email = `email${nanoid().toLowerCase()}@gmail.com`;
    const args: MutationSignUpArgs = {
      data: {
        email,
        firstName: "firstName",
        lastName: "lastName",
        password: "password",
        appLanguageCode: "en",
        selectedOrgainzation: localTestOrganization[1]?.id,
      },
    };
    const { signUp: signUpResolver } = await import(
      "../../../src/resolvers/Mutation/signUp"
    );
    await signUpResolver?.({}, args, {});
    const createdUser = await User.findOne({
      email,
    });
    const createdAppUserProfile = await AppUserProfile.findOne({
      userId: createdUser?._id,
    });
    expect(createdUser?.userType).not.to.toEqual("SUPERADMIN");
    expect(createdAppUserProfile?.adminApproved).toBeFalsy();
  });
});

describe("resolvers -> Mutation -> signUp", () => {
  afterEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it(`throws ConflictError  message if a user already with email === args.data.email already exists`, async () => {
    const EMAIL_MESSAGE = "email.alreadyExists";
    const { requestContext } = await import("../../../src/libraries");
    const spy = vi
      .spyOn(requestContext, "translate")
      .mockImplementationOnce((message) => message);
    try {
      const args: MutationSignUpArgs = {
        data: {
          email: testUser?.email,
          firstName: "firstName",
          lastName: "lastName",
          password: "password",
          appLanguageCode: "en",
          selectedOrgainzation: testOrganization?.id,
        },
      };

      const { signUp: signUpResolver } = await import(
        "../../../src/resolvers/Mutation/signUp"
      );

      await signUpResolver?.({}, args, {});
    } catch (error: unknown) {
      expect(spy).toBeCalledWith(EMAIL_MESSAGE);
      expect((error as Error).message).toEqual(EMAIL_MESSAGE);
    }
  });
  it(`throws NotFoundError message if no organization exists with _id === args.data.organizationUserBelongsToId`, async () => {
    const { requestContext } = await import("../../../src/libraries");
    const spy = vi
      .spyOn(requestContext, "translate")
      .mockImplementationOnce((message) => message);
    try {
      const email = `email${nanoid().toLowerCase()}@gmail.com`;

      const args: MutationSignUpArgs = {
        data: {
          email,
          firstName: "firstName",
          lastName: "lastName",
          password: "password",
          appLanguageCode: "en",
          selectedOrgainzation: new Types.ObjectId().toString(),
        },
      };

      const { signUp: signUpResolver } = await import(
        "../../../src/resolvers/Mutation/signUp"
      );

      await signUpResolver?.({}, args, {});
    } catch (error: unknown) {
      expect(spy).toBeCalledWith(ORGANIZATION_NOT_FOUND_ERROR.MESSAGE);
      expect((error as Error).message).toEqual(
        ORGANIZATION_NOT_FOUND_ERROR.MESSAGE,
      );
    }
  });
});
