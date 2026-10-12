plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.ptx7.pimsscanner"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.ptx7.pimsscanner"
        minSdk = 23
        targetSdk = 35
        versionCode = 47
        versionName = "2.0.0-beta.18"
    }

    // One permanent signing key for every CI build. Without it, GitHub creates a
    // new throwaway key per build, so updates cannot install over the old app;
    // the required uninstall wipes the saved Okta / FastPass sign-in.
    signingConfigs {
        getByName("debug") {
            storeFile = file("ptx7-debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    buildTypes {
        getByName("debug") {
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.camera:camera-core:1.4.2")
    implementation("androidx.camera:camera-camera2:1.4.2")
    implementation("androidx.camera:camera-lifecycle:1.4.2")
    implementation("androidx.camera:camera-view:1.4.2")

    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("com.google.mlkit:barcode-scanning:17.3.0")
}
