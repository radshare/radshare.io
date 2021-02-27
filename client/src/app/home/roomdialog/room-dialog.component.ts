import {Component, Inject, OnInit} from '@angular/core';
import {MAT_DIALOG_DATA, MatDialogRef} from '@angular/material/dialog';

@Component({
  selector: 'app-roomdialog',
  templateUrl: './room-dialog.component.html',
  styleUrls: ['./room-dialog.component.css']
})
export class RoomDialogComponent implements OnInit {

  constructor(@Inject(MAT_DIALOG_DATA) private data: any, private dialogRef: MatDialogRef<RoomDialogComponent>) {
    console.log('data', this.data);
  }

  ngOnInit(): void {
  }

  getChosenRoom(){
    return this.data;
  }

  joinRoom() {
    this.dialogRef.close(true);
  }

}
