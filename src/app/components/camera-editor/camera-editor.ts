import { Component, inject, input } from '@angular/core';
import { Camera } from '../../models/camera.model';
import { CameraService } from '../../services/camera.service';

@Component({
  selector: 'app-camera-editor',
  templateUrl: './camera-editor.html',
  styleUrl: './camera-editor.css',
})
export class CameraEditorComponent {
  private cameraService = inject(CameraService);

  camera = input.required<Camera>();

  protected updateName(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.cameraService.updateCamera(this.camera().id, { name: value });
  }

  protected updateHeading(event: Event): void {
    const value = +(event.target as HTMLInputElement).value;
    this.cameraService.updateCamera(this.camera().id, { heading: value });
  }

  protected updateFov(event: Event): void {
    const value = +(event.target as HTMLInputElement).value;
    this.cameraService.updateCamera(this.camera().id, { fov: value });
  }

  protected updateRange(event: Event): void {
    const value = +(event.target as HTMLInputElement).value;
    this.cameraService.updateCamera(this.camera().id, { range: value });
  }
}
