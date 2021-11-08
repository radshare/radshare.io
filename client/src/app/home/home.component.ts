import {AfterViewInit, Component, ViewChild} from '@angular/core';
import {RelicService} from '../services/relic.service';
import {MatPaginator} from '@angular/material/paginator';
import {MatSort} from '@angular/material/sort';
import {MatDialog, MatDialogConfig} from '@angular/material/dialog';
import {RadDialogComponent} from './raddialog/rad-dialog.component';
import {catchError, map, startWith, switchMap} from 'rxjs/operators';
import {merge, of} from 'rxjs';
import {MatTableDataSource} from '@angular/material/table';
import {AuthenticationService} from '../services/authentication.service';
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

  // Load radshare rooms into the table on page load
  loadRadshares():void {
    merge() //empty observable
      // Run functions in sequence using pipe
      .pipe(
        // Create observable that emits empty values then source values
        // So that the data actually ends up getting emitted
        startWith({}),
        // Switches values to the result observable (aka the http request observable)
        // instead of the empty source one
        switchMap(() => {
          this.isLoadingResults = true;
          return this.relics.getRadshares();
        }),
        // Parse the observable data
        map(data => {
          // Flip flag to show that loading has finished.
          this.isLoadingResults = false;
          this.resultsLength = data.total_count;
          // Turn the expiration date from milliseconds to a displayable format
          data.data.forEach( (room) => {
            let totalMins = Math.round((room.expirationDate - Date.now()) / 1000 / 60);
            let mins = totalMins % 60;
            let hrs = Math.floor(totalMins / 60);
            room.expirationDate = hrs + ':' + mins.toString().padStart(2, '0');
          });
          return data.data;
        }),
        // Deal with any errors that happened when getting data
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

  gotoRoom(returnedRoomID: string){
    // Set the user's registered room in the relic service and navigate to the page
    this.relics.setRegisteredRoomID(returnedRoomID);
    this.router.navigateByUrl("/room", { skipLocationChange: true })
  }

  joinRoom(returnedRoomID: string){
    // Register the user to the room
    this.relics.joinRoom(returnedRoomID).subscribe(() => {
    });
    this.gotoRoom(returnedRoomID);
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
          // A room was returned, so putUser it into the database
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
    this.openJoinRoomDialog(row);
  }

  openJoinRoomDialog(chosenRoom: RadRoom) {
    if (!this.auth.isLoggedIn()){
      this.redirectToLogin();
    }
    else{
      this.roomDialog.open(RoomDialogComponent, {data: {room: chosenRoom}, })
        .afterClosed().subscribe((confirmedRoom) => {
          if (confirmedRoom){
            // User wants to join the room
            this.joinRoom(confirmedRoom.room._id);
          }
      });
    }
  }

}
