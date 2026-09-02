#!/usr/bin/env swift

import Foundation
import Vision
import CoreImage

func decodeQrCode(from imagePath: String) -> String? {
    // Check if file exists
    guard FileManager.default.fileExists(atPath: imagePath) else {
        return nil
    }

    // Read the image file
    guard let imageData = try? Data(contentsOf: URL(fileURLWithPath: imagePath)) else {
        return nil
    }

    // Create a CIImage from the data
    guard let ciImage = CIImage(data: imageData) else {
        return nil
    }

    // Create a request to detect barcodes
    let request = VNDetectBarcodesRequest()
    request.symbologies = [.qr]

    // Create a request handler
    let handler = VNImageRequestHandler(ciImage: ciImage, options: [:])

    // Perform the request
    var detectedPayload: String? = nil
    do {
        try handler.perform([request])

        // Process results
        if let results = request.results as? [VNBarcodeObservation] {
            if let firstResult = results.first {
                if let payload = firstResult.payloadStringValue {
                    detectedPayload = payload
                }
            }
        }
    } catch {
        return nil
    }

    return detectedPayload
}

// Check command line arguments
guard CommandLine.arguments.count == 2 else {
    fputs("Usage: swift scripts/qr-decode.swift <png-path>\n", stderr)
    exit(1)
}

let imagePath = CommandLine.arguments[1]

// Attempt to decode
if let payload = decodeQrCode(from: imagePath) {
    print(payload)
    exit(0)
} else {
    fputs("Error: Could not decode QR code from \(imagePath)\n", stderr)
    exit(1)
}
