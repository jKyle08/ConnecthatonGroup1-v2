-- Run in SSMS while connected to ICT-CINDY (Windows Auth is fine)
IF DB_ID(N'EReferralLocal') IS NULL
BEGIN
  CREATE DATABASE EReferralLocal;
END
GO

USE EReferralLocal;
GO

IF OBJECT_ID(N'dbo.Patients', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.Patients (
    Id              INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    LocalCode       NVARCHAR(40)  NOT NULL UNIQUE,
    PhilSysId       NVARCHAR(40)  NOT NULL UNIQUE,
    PhilHealthId    NVARCHAR(40)  NULL,
    FamilyName      NVARCHAR(100) NOT NULL,
    GivenName1      NVARCHAR(100) NOT NULL,
    GivenName2      NVARCHAR(100) NULL,
    Gender          NVARCHAR(20)  NOT NULL,
    BirthDate       DATE          NOT NULL,
    Phone           NVARCHAR(40)  NULL,
    AddressLine     NVARCHAR(200) NULL,
    RegionCode      NVARCHAR(20)  NULL,
    RegionDisplay   NVARCHAR(100) NULL,
    ProvinceCode    NVARCHAR(20)  NULL,
    ProvinceDisplay NVARCHAR(100) NULL,
    CityCode        NVARCHAR(20)  NULL,
    CityDisplay     NVARCHAR(100) NULL,
    BarangayCode    NVARCHAR(20)  NULL,
    BarangayDisplay NVARCHAR(100) NULL,
    PostalCode      NVARCHAR(20)  NULL,
    NextOfKinFamily NVARCHAR(100) NULL,
    NextOfKinGiven  NVARCHAR(100) NULL,
    FhirId          NVARCHAR(64)  NULL,
    SyncStatus      NVARCHAR(20)  NOT NULL CONSTRAINT DF_Patients_SyncStatus DEFAULT (N'pending'),
    SyncError       NVARCHAR(MAX) NULL,
    SyncedAt        DATETIME2     NULL,
    CreatedAt       DATETIME2     NOT NULL CONSTRAINT DF_Patients_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt       DATETIME2     NOT NULL CONSTRAINT DF_Patients_UpdatedAt DEFAULT (SYSUTCDATETIME())
  );
END
GO

IF OBJECT_ID(N'dbo.Organizations', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.Organizations (
    Id              INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    LocalCode       NVARCHAR(40)  NOT NULL UNIQUE,
    Name            NVARCHAR(200) NOT NULL,
    NhfrCode        NVARCHAR(40)  NOT NULL UNIQUE,
    HcpnCode        NVARCHAR(100) NULL,
    Phone           NVARCHAR(40)  NULL,
    AddressLine     NVARCHAR(200) NULL,
    RegionCode      NVARCHAR(20)  NULL,
    RegionDisplay   NVARCHAR(100) NULL,
    ProvinceCode    NVARCHAR(20)  NULL,
    ProvinceDisplay NVARCHAR(100) NULL,
    CityCode        NVARCHAR(20)  NULL,
    CityDisplay     NVARCHAR(100) NULL,
    BarangayCode    NVARCHAR(20)  NULL,
    BarangayDisplay NVARCHAR(100) NULL,
    PostalCode      NVARCHAR(20)  NULL,
    FhirId          NVARCHAR(64)  NULL,
    SyncStatus      NVARCHAR(20)  NOT NULL CONSTRAINT DF_Organizations_SyncStatus DEFAULT (N'pending'),
    SyncError       NVARCHAR(MAX) NULL,
    SyncedAt        DATETIME2     NULL,
    CreatedAt       DATETIME2     NOT NULL CONSTRAINT DF_Organizations_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt       DATETIME2     NOT NULL CONSTRAINT DF_Organizations_UpdatedAt DEFAULT (SYSUTCDATETIME())
  );
END
GO

IF OBJECT_ID(N'dbo.Practitioners', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.Practitioners (
    Id              INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    LocalCode       NVARCHAR(40)  NOT NULL UNIQUE,
    PrcId           NVARCHAR(40)  NOT NULL UNIQUE,
    FamilyName      NVARCHAR(100) NOT NULL,
    GivenName       NVARCHAR(100) NOT NULL,
    Prefix          NVARCHAR(40)  NULL,
    Phone           NVARCHAR(40)  NULL,
    RoleCode        NVARCHAR(40)  NULL,
    RoleDisplay     NVARCHAR(200) NULL,
    RoleFhirId      NVARCHAR(64)  NULL,
    OrganizationFhirId NVARCHAR(64) NULL,
    FhirId          NVARCHAR(64)  NULL,
    SyncStatus      NVARCHAR(20)  NOT NULL CONSTRAINT DF_Practitioners_SyncStatus DEFAULT (N'pending'),
    SyncError       NVARCHAR(MAX) NULL,
    SyncedAt        DATETIME2     NULL,
    CreatedAt       DATETIME2     NOT NULL CONSTRAINT DF_Practitioners_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt       DATETIME2     NOT NULL CONSTRAINT DF_Practitioners_UpdatedAt DEFAULT (SYSUTCDATETIME())
  );
END
GO

IF OBJECT_ID(N'dbo.PractitionerRoles', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.PractitionerRoles (
    Id                   INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    LocalCode            NVARCHAR(40)  NOT NULL UNIQUE,
    PrcId                NVARCHAR(40)  NOT NULL,
    PractitionerFhirId   NVARCHAR(64)  NULL,
    PractitionerName     NVARCHAR(200) NULL,
    OrganizationFhirId   NVARCHAR(64)  NULL,
    OrganizationName     NVARCHAR(200) NULL,
    RoleCode             NVARCHAR(40)  NOT NULL,
    RoleDisplay          NVARCHAR(200) NOT NULL,
    Active               BIT           NOT NULL CONSTRAINT DF_PractitionerRoles_Active DEFAULT (1),
    FhirId               NVARCHAR(64)  NULL,
    SyncStatus           NVARCHAR(20)  NOT NULL CONSTRAINT DF_PractitionerRoles_SyncStatus DEFAULT (N'pending'),
    SyncError            NVARCHAR(MAX) NULL,
    SyncedAt             DATETIME2     NULL,
    CreatedAt            DATETIME2     NOT NULL CONSTRAINT DF_PractitionerRoles_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt            DATETIME2     NOT NULL CONSTRAINT DF_PractitionerRoles_UpdatedAt DEFAULT (SYSUTCDATETIME())
  );
END
GO

IF OBJECT_ID(N'dbo.ActivityLog', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.ActivityLog (
    Id          INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    EventType   NVARCHAR(40)  NOT NULL,
    EntityName  NVARCHAR(200) NOT NULL,
    ActionText  NVARCHAR(200) NOT NULL,
    SyncStatus  NVARCHAR(20)  NOT NULL,
    Details     NVARCHAR(500) NULL,
    CreatedAt   DATETIME2     NOT NULL CONSTRAINT DF_ActivityLog_CreatedAt DEFAULT (SYSUTCDATETIME())
  );
END
GO

-- App login for Node (SQL Auth). Requires Mixed Mode on SQL Server.
USE master;
GO
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'ereferral_app')
BEGIN
  CREATE LOGIN ereferral_app WITH PASSWORD = N'EReferral@Local2026', CHECK_POLICY = OFF;
END
GO
USE EReferralLocal;
GO
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'ereferral_app')
BEGIN
  CREATE USER ereferral_app FOR LOGIN ereferral_app;
END
GO
ALTER ROLE db_owner ADD MEMBER ereferral_app;
GO
