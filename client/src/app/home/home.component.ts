import {AfterViewInit, Component, ViewChild} from '@angular/core';
import {RelicService} from '../relic.service';
import {MatPaginator} from '@angular/material/paginator';
import {MatSort} from '@angular/material/sort';
import {MatDialog, MatDialogConfig} from '@angular/material/dialog';
import {RadDialogComponent} from './raddialog/rad-dialog.component';
import {catchError, map, startWith, switchMap} from 'rxjs/operators';
import {merge, of} from 'rxjs';
import {MatTableDataSource} from '@angular/material/table';
import {AuthenticationService} from '../authentication.service';
import {Router} from '@angular/router';
import {RoomDialogComponent} from './roomdialog/room-dialog.component';

export interface RadRoom {
  expirationDate?: number;
  relic: string;
  quality: string;
  platform: string;
  code?: string;
}

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css']
})
export class HomeComponent implements AfterViewInit{
  displayedColumns: string[] = ['relic', 'quality', 'platform', 'tenno', 'expirationDate'];
  private isLoadingResults: boolean;
  private resultsLength = 0;
  dataSource: MatTableDataSource<RadRoom[]>;

  @ViewChild(MatPaginator) paginator: MatPaginator;
  @ViewChild(MatSort) sort: MatSort;

  constructor(private relics: RelicService, private auth: AuthenticationService,
              private radDialog: MatDialog, private roomDialog: MatDialog, private router: Router) {}

  ngAfterViewInit(){
    this.sort.sortChange.subscribe(() => this.paginator.pageIndex = 0);
    this.loadRadshares();
  }

  loadRadshares():void {
    // Load radshare rooms into the table on page load
    merge()
      .pipe(
        startWith({}),
        switchMap(() => {
          this.isLoadingResults = true;
          return this.relics.getRadshares();
        }),
        map(data => {
          // Flip flag to show that loading has finished.
          this.isLoadingResults = false;
          this.resultsLength = data.total_count;
          // Turn the expiration date from milliseconds to a displayable format
          data.data.forEach( (room) => {
            var totalMins = Math.round((room.expirationDate - Date.now()) / 1000 / 60);
            var mins = totalMins % 60;
            var hrs = Math.floor(totalMins / 60);
            room.expirationDate = hrs + ':' + mins.toString().padStart(2, '0');
          });
          return data.data;
        }),
        catchError((err) => {
          console.error(err);
          this.isLoadingResults = false;
          return of([]);
        })
      ).subscribe(data => {
        // Success, set table reference to data
      this.dataSource = new MatTableDataSource(data);
      this.dataSource.paginator = this.paginator;
      this.dataSource.sort = this.sort;
    });
  }

  redirectToLogin(){
    this.router.navigateByUrl("/login");
  }

  gotoRoom(returnedRoom: string){
    // Register the user to the room
    this.relics.joinRoom(returnedRoom).subscribe();
    // Navigate to the room page
    this.router.navigateByUrl("/room", { skipLocationChange: true })
  }

  openNewRadDialog() {
    if (!this.auth.isLoggedIn()){
      this.redirectToLogin();
    }
    else{
      const dialogConfig = new MatDialogConfig();
      dialogConfig.autoFocus = true;

      this.radDialog.open(RadDialogComponent, dialogConfig)
        .afterClosed().subscribe( (roomCreated) => {
          // A room was returned, so put it into the database
          if (roomCreated){
            this.relics.newRoom(roomCreated).subscribe(returnedRoom => {
              // Register the user to the room and bring them to the room page
              this.gotoRoom(returnedRoom.data._id);
              });
          }
        }
      );
    }
  }

  joinRoomPrompt(row: any) {
    console.log(row);
    this.openJoinRoomDialog(row);
  }

  openJoinRoomDialog(chosenRoom: RadRoom) {
    if (!this.auth.isLoggedIn()){
      this.redirectToLogin();
    }
    else{
      this.roomDialog.open(RoomDialogComponent, {data: {room: chosenRoom}, })
        .afterClosed().subscribe((confirmationTrue) => {
          if (confirmationTrue){
            // User wants to join the room
            this.gotoRoom(confirmationTrue.room._id);
          }
      });
    }
  }

}
